# 10 — Terminal на PowerShell; закрытие Terminal гасит дерево процессов

Type: task
Status: open
Blocked by: 09
Source: решения владельца 2026-10-07: Q20 (Terminal на Windows — PowerShell: `pwsh`, иначе Windows PowerShell; Git Bash — в настройках), Q24 (Windows 10 21H2+ и 11, x64: ConPTY везде) ([spec.md](../spec.md)); [ADR-0054](../../../docs/adr/0054-full-windows-port.md) «Full Windows port» (пункты 2 и 4); [ADR-0052](../../../docs/adr/0052-machines-and-linking.md) (Project живёт на одной Machine); [ADR-0006](../../../docs/adr/0006-ipc-contract-by-declaration-merging.md) (контракт IPC); [ADR-0007](../../../docs/adr/0007-claude-code-launch-environment.md)

## Что происходит

- Terminal (Node с shell-сессией пользователя) запускает `TerminalRegistry`
  (`src/main/terminal/pty.ts`). Оболочка — `env.SHELL ?? '/bin/zsh'` с аргументом `-l` (`:227`,
  `:229`). Окружение — `agentEnv()` (`src/main/ipc/terminal.ts:137`) плюс переменные терминала
  (`terminalEnv`, `pty.ts:38-48`). Запрос на запуск — `{ cwd, cols, rows, restart }`
  (`src/main/ipc/terminal.ts:66-70`).
- На Windows `SHELL` в окружении нет, и Terminal пробует запустить `/bin/zsh`. По коду запуск
  падает. node-pty сам по умолчанию берёт `cmd.exe` (`node_modules/node-pty/lib/windowsTerminal.js:25`),
  но worfy всегда передаёт файл. ADR-0054: `cmd.exe` не используется.
- **Закрытие** (`close`, `pty.ts:276-294`): SIGHUP группе `-pid` и самому `pid` (`:285-286`), через
  `KILL_GRACE_MS` (1 s, `:26`) — SIGKILL (`:287-290`). `signalProcess` глотает ошибки
  `process.kill` (`:149-155`). На Windows групп процессов и SIGHUP нет. Что из этого сделает
  `process.kill` на Windows, не проверялось. По коду дочерние процессы оболочки так не гасятся.
- node-pty на Windows: `kill(signal)` с сигналом бросает «Signals not supported on windows.»
  (`node_modules/node-pty/lib/windowsTerminal.js:147-155`). `kill()` без сигнала при ConPTY
  завершает процессы консоли (`_getConsoleProcessList`) и закрывает псевдоконсоль
  (`node_modules/node-pty/lib/windowsPtyAgent.js:133-160`). Процесс, у которого своя консоль или
  окно (например, запущенный через `Start-Process`), в этот список не входит.
- ConPTY node-pty включает при сборке Windows ≥ 18309 (`lib/windowsPtyAgent.js:37-38`). Q24 —
  Windows 10 21H2 (сборка 19044) и новее, ветка winpty не нужна. На ПК владельца (build 26200)
  node-pty из `prebuilds/win32-x64` в Electron 44.5.1 запускает через ConPTY `cmd.exe`, `pwsh.exe`,
  `powershell.exe` и `C:\Program Files\Git\bin\bash.exe --login` (evidence Ticket-а 01, разделы 01 и
  09). Аргумент с двойными кавычками внутри (`Write-Output ("worfy-" + (2+3))`) обе PowerShell
  получили сломанным, EXIT=1: node-pty склеивает аргументы в командную строку.
- **pwsh из winget — MSIX.** `winget install Microsoft.PowerShell` на ПК поставил пакет MSIX
  (`C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.6.0_…`), а в `Path` лежит только псевдоним
  `%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe`. node-pty его запускает, но `fs.existsSync` по
  этому пути — `false`, `fs.statSync` — `EACCES`, `fs.lstatSync` видит symlink (evidence, разделы 09,
  16 и 25). Поиск «файл есть в `Path`» через `existsSync` такой pwsh пропустит.
- На ПК `test/contract/terminal.test.ts` — 20 упавших, `terminal.open failed: File not found:`;
  `test/contract/node-pty.test.ts` — 1, спавнит `/bin/echo` (evidence, раздел 17).
- **Настроек оболочки нет.** Единственный экран настроек worfy — настройки Project-а: окно
  `src/renderer/shell/ProjectSettings.tsx`, схема `projectSettingsSchema`
  (`src/shared/projects/action-templates.ts:120-123`), файл `<папка данных Project-а>/settings.json`
  (`src/main/projects/settings.ts:17-44`). В схеме только шаблоны действий. Окно сохраняет
  `{ actionTemplates }` целиком (`ProjectSettings.tsx:106`).
- **Test-ы.** `test/contract/terminal.test.ts` гоняет настоящий pty на `/bin/sh` (harness `:70-75`):
  `:139` — закрытие по SIGHUP, `:258` — оболочка, которая игнорирует SIGHUP, `:376` — выход из
  worfy. `:163` — настоящий `$SHELL -l`, только на Mac. На Windows `/bin/sh` нет — что упало на ПК,
  в списке Ticket-а 02 (Итог). `test/e2e/terminal.spec.ts` — e2e на Mac.
- E3 Ticket 19 (экран первого запуска) запускает в Terminal Node `gh auth login`; в его «Что
  происходит» у `terminal.open` команды нет (`src/shared/ipc/terminal.ts:25-33`). Строки выше — main
  4f983ef. Перед началом перечитать `pty.ts`, `src/main/ipc/terminal.ts` и
  `src/shared/ipc/terminal.ts` на свежем main. Если E3 добавил запуск команды в Terminal, этот
  Ticket повторяет его для PowerShell и Git Bash так, чтобы после команды оболочка оставалась
  открытой, как на Mac.

## Что делаем

1. **Оболочка по системе** (Q20, ADR-0054 пункт 4). В `pty.ts` — экспортируемая `terminalShell`: файл
   и аргументы по системе, настройке и окружению. Её же берёт экран первого запуска (Ticket 13).
   - Не Windows — `env.SHELL ?? '/bin/zsh'` с `-l`, как сейчас.
   - Windows, PowerShell (по умолчанию): `pwsh.exe` из `Path` окружения агента (`findOnPath`,
     Ticket 09); нет его — `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`. Аргумент
     `-NoLogo`, без `-l`. Поиск находит и pwsh из MSIX — псевдоним в `WindowsApps`, который
     `fs.existsSync` не видит (evidence Ticket-а 01, раздел 25): например, через `fs.lstatSync`.
   - Windows, Git Bash: `findGitBash` (Ticket 09) с `--login -i`. Git Bash не найден — Terminal
     запускает PowerShell, причина — в лог.

   `OpenResult.shell` — имя файла (`pwsh.exe`, `powershell.exe`, `bash.exe`); Terminal Node
   показывает его, как сейчас.
2. **Настройка оболочки** (Q20: Git Bash — в настройках).
   - Поле `terminalShell: 'powershell' | 'git-bash'` в `projectSettingsSchema`, необязательное.
     Нет поля — PowerShell. При чтении поле не дописывается, поэтому ожидания
     `test/contract/projects.test.ts:210` и `:317` не меняются.
   - Новый канал `terminal.shells` (ADR-0006): какие оболочки есть на этой Machine. На Mac — пустой
     список. На Windows — PowerShell с пометкой, какой (`pwsh` или Windows PowerShell), и Git Bash с
     признаком «найден».
   - Окно настроек Project-а показывает выбор, только когда список не пуст. Сохранение отправляет и
     шаблоны действий, и `terminalShell`.
   - main берёт настройку Project-а при запуске оболочки (`src/main/ipc/terminal.ts:66-70`). Новая
     оболочка — у следующего запуска: кнопка Restart или новый Terminal Node. Запущенные оболочки не
     перезапускаются.

   Решено в Ticket-е, подтвердить у владельца: выбор живёт в настройках Project-а. Других настроек у
   worfy нет, а Project живёт на одной Machine (ADR-0052) — значит, выбор относится к этой Machine.
3. **Закрытие на Windows** (Q24: ConPTY во всех поддерживаемых версиях). `close` на `win32`:
   - сначала гасит дерево процессов оболочки: `%SystemRoot%\System32\taskkill.exe /PID <pid> /T /F`.
     Windows строит дерево по родителю живых процессов: когда оболочка уже вышла, её потомков `/T`
     не найдёт. Поэтому дерево гасится до выхода оболочки;
   - затем `pty.kill()` без сигнала: node-pty завершает процессы консоли и закрывает ConPTY;
   - сигналов `-pid`, SIGHUP и SIGKILL на Windows нет.

   Ожидание выхода (`terminal.exited`) и `closeAll` при выходе из worfy
   (`src/main/ipc/terminal.ts:124-129`) работают, как на Mac. Способ погасить дерево — `taskkill`
   или свой обход по `ParentProcessId` — на выбор Ticket-а; test проверяет итог.
   Процесс, запущенный из Terminal через `Start-Process`, — тоже потомок оболочки, он гасится. На Mac
   приложение из `open` закрытие Terminal переживает. Это отличие — в Итог.
4. **Mac не меняется.** Ветка `darwin` в `start` и `close` — прежний код. Платформа и функция,
   которая гасит дерево, передаются через `TerminalRegistryOptions` (`pty.ts:142-147`). Так
   unit-test-ы проверяют ветку `win32` на Mac и в Linux CI.
5. **`test/contract/terminal.test.ts` на Windows.** Harness на `win32` задаёт оболочку явно —
   PowerShell без профиля пользователя (как пустой `HOME` для `/bin/sh` на Mac). Test-ы закрытия
   (`:139`, `:258`, `:376`) на `win32` проверяют, что pid оболочки и её потомка исчезли. Где смысла
   на Windows нет (оболочка, которая игнорирует SIGHUP) — пропуск на `win32` с причиной в
   комментарии. Рядом с `:163` — такой же test для `win32`: PowerShell и Git Bash на настоящем pty.

**Не входит:** e2e Terminal на Windows (Ticket 14); Ctrl+C, Ctrl+K и другие Ctrl-сочетания внутри
Terminal на фоне ускорителей меню и горячих клавиш worfy (Ticket 11).

## Готово, когда

- [x] Unit `test/unit/terminal-shell.test.ts` (новый): `win32`, PowerShell, `pwsh.exe` в `Path` →
  `pwsh.exe` и `['-NoLogo']`; `pwsh.exe` — псевдоним MSIX в `WindowsApps` (`existsSync` — false,
  `lstat` — symlink) → тоже `pwsh.exe`; без `pwsh` → `…\WindowsPowerShell\v1.0\powershell.exe`; Git Bash →
  `bash.exe` и `['--login', '-i']`; Git Bash выбран, но не найден → PowerShell; `darwin` →
  `$SHELL -l`, без `SHELL` — `/bin/zsh -l`.
- [x] Unit (`TerminalRegistry` с подменённым `spawn`): на `win32` `close` вызывает функцию, которая
  гасит дерево, с `pid` оболочки, затем `pty.kill()` без аргумента, и не вызывает `process.kill` с
  отрицательным `pid`; на `darwin` — SIGHUP группе и SIGKILL после `KILL_GRACE_MS`, как сейчас.
- [ ] Contract `test/contract/projects.test.ts`: `settings.json` без `terminalShell` читается без
  поля; `projects.settings.set` с `git-bash` сохраняет его; неизвестное значение отвергается схемой.
  Contract `terminal.shells`: на `darwin` — пустой список.
- [x] `test/contract/terminal.test.ts`, test для `win32` на настоящем pty, на Windows-ПК:
  - PowerShell: ввод `Write-Output "worfy-$(2+3)"` печатает `worfy-5`;
  - Git Bash: ввод `echo "worfy-$((2+3))"` печатает `worfy-5`;
  - в PowerShell запущен `node -e "console.log('pid=' + process.pid); setInterval(() => {}, 1000)"`;
    после `terminal.close` процесса с этим pid нет (`process.kill(pid, 0)` бросает `ESRCH`) не позже
    `KILL_GRACE_MS` + 1 s. То же для процесса, запущенного через `Start-Process`.
- [x] Windows-ПК: `pnpm test test/unit/terminal-shell.test.ts test/contract/terminal.test.ts` —
  exit 0; test-ы `win32` выполнены, а не пропущены (вывод vitest).
- [ ] Windows-ПК, проверка платформенного PR (Q23, ADR-0056): gate full — строка вердикта и код выхода
  в отчёт. Пока Gate не на Node (Ticket 03) — `pnpm lint`, `pnpm typecheck`, `pnpm test` с кодами
  выхода и пометка «Gate не запускался». Падения `pnpm test` сверены со списком Ticket-а 02: новых
  нет.
- [ ] (вручную) Windows-ПК, `pnpm dev`: новый Terminal Node открывает PowerShell, приглашение видно,
  ввод и вывод идут. В настройках Project-а выбран Git Bash, Restart — в Terminal `bash`. В Terminal
  запущен `node -e "setInterval(() => {}, 1000)"`, Terminal Node закрыт — в
  `Get-Process node, pwsh, bash` нет процессов этого Terminal. Как проверить: окно worfy и
  PowerShell вне worfy.
- [ ] Mac: `test/contract/terminal.test.ts` и e2e `test/e2e/terminal.spec.ts` зелёные с прежними
  ожиданиями; в окне настроек Project-а выбора оболочки нет; gate full на Mac зелёный (по правилу needs-mac-gate: проверяет и вливает Session на Mac).

## Тесты

Сначала падающий test — unit `terminalShell` для `win32` в `test/unit/terminal-shell.test.ts`:
сейчас Terminal на любой системе запускает `$SHELL` или `/bin/zsh` с `-l`. Затем unit `close` на
`win32`: сейчас он шлёт SIGHUP группе `-pid`.

Ветки `win32` в unit-test-ах идут на Mac и в Linux CI: платформа, `Path` и функция, которая гасит
дерево, передаются явно. Test-ы с настоящими PowerShell и Git Bash — только на `win32`; на
Windows-ПК они обязательны. В «Итог» — как test-ы падали до правки и какие test-ы
`terminal.test.ts` пропущены на `win32` и почему.

## Где в коде

- `src/main/terminal/pty.ts`
- `src/main/ipc/terminal.ts`
- `src/shared/ipc/terminal.ts`
- `src/shared/projects/action-templates.ts`
- `src/main/projects/settings.ts`
- `src/renderer/shell/ProjectSettings.tsx`
- `test/unit/terminal-shell.test.ts` (новый)
- `test/contract/terminal.test.ts`
- `test/contract/projects.test.ts`

`src/main/agent/env.ts` (`findOnPath`, `findGitBash` из Ticket-а 09) только читается.

## Итог

Заполняет Session на Windows-ПК. Что не проверено и что ждёт владельца и Mac — в конце.

- **Что сделано.**
  - **Оболочка по системе** (`src/main/terminal/pty.ts`, `terminalShell`). Не Windows —
    `$SHELL -l`, без переменной `/bin/zsh -l`, как раньше. Windows — PowerShell с `-NoLogo`:
    `pwsh.exe` из `Path` окружения агента, иначе Windows PowerShell из `%SystemRoot%` по полному
    пути; с настройкой `git-bash` — Git Bash с `--login -i`, а когда его нет — PowerShell и строка
    в лог. `$SHELL` и `cmd.exe` на Windows не берутся.
  - **Закрытие на Windows** (`close` → `endWindowsShell`), после первого круга ревью: сначала
    гасятся процессы под оболочкой (`endDescendants`: скрипт Windows PowerShell из
    `%SystemRoot%`), пока оболочка жива, затем `pty.kill()` без сигнала — он закрывает
    псевдоконсоль, а с ней оболочку и то, что на её консоли. У всего закрытия есть верхняя граница
    5 с. Сигналов и группы процессов там нет. Ветка не для Windows — прежний код.
  - **Настройка** `terminalShell: 'powershell' | 'git-bash'` в `projectSettingsSchema`,
    необязательная. Её спрашивает registry — только на Windows и только когда запускает оболочку
    (`TerminalDeps.shellSetting`); от renderer она не приходит. Неизвестное значение в
    `settings.json` читается как «не выбрано» (`savedProjectSettingsSchema`), сохранить такое
    нельзя.
  - **Канал `terminal.shells`**: оболочки этой Machine для окна настроек. Не Windows — пустой
    список; Windows — PowerShell (с подписью, какая именно запустится) и Git Bash с признаком
    «найден».
  - **Окно настроек Project-а** показывает поле «Terminal shell», только когда список не пуст;
    сохраняет и шаблоны, и выбор. Пока пользователь не выбрал, поле в файл не пишется.
  - **Команда в Terminal** (`gh auth login` экрана первого запуска, E3 Ticket 19 добавил её после
    того, как Ticket был написан): на Windows набирается с `\r`, не с `\n`. Оболочка после команды
    остаётся открытой, как на Mac.
- **Решения этого Ticket-а.**
  - **Дерево гасит свой обход, не `taskkill`** (первый круг ревью заменил прежнее решение).
    `taskkill /T /F` уносит и саму оболочку, а node-pty забывает псевдоконсоль в момент выхода
    оболочки — после этого её нечем закрыть. Скрипт `endDescendants` гасит только то, что под
    оболочкой, и отличает процессы по времени создания, не по одному pid — подробности в разделе
    «Первый круг ревью».
  - **`pty.kill()` — всегда, и без помощника node-pty.** Он закрывает псевдоконсоль и
    останавливает рабочий поток node-pty. Помощник node-pty, который печатал `Error: AttachConsole
    failed`, из `kill()` убран (`withoutConsoleHelper`).
  - **Выбор оболочки — в настройках Project-а** (решение Ticket-а; владелец подтвердил
    2026-10-12 — ниже).
  - **Имя оболочки** в `OpenResult.shell` — имя файла по правилам той системы: `pwsh.exe`,
    `powershell.exe`, `bash.exe`.
- **Что показал Windows.**
  - **Событие выхода приходит примерно через секунду после смерти процесса.** node-pty после
    выхода процесса ждёт остаток вывода (`FLUSH_DATA_INTERVAL` = 1000 мс) и только потом сообщает
    о выходе. Процессы исчезают сразу, а `terminal.close` и `closeAll` завершаются на секунду
    позже. Трём ожиданиям в `terminal.test.ts` дан запас 5 с вместо секунды по умолчанию.
  - **pwsh из MSIX запускается**: на ПК `pwsh.exe` — псевдоним в `WindowsApps`; test на настоящем
    pty стартует его и получает `edition=Core`.
  - **Программа из `Start-Process` гаснет вместе с Terminal**: она потомок оболочки. На Mac
    приложение, запущенное через `open`, закрытие Terminal переживает. Это отличие систем.
- **`test/contract/terminal.test.ts` на Windows.** Harness там запускает Windows PowerShell без
  профиля: в `Path` только системные папки, все папки пользователя (`USERPROFILE`, `APPDATA`,
  `LOCALAPPDATA`, `TEMP`) — временные, чтобы ни профиль, ни история PSReadLine машины не
  участвовали; к аргументам добавлен `-NoProfile`. Набираемые команды получили запись для обеих
  оболочек (`say`, `sayTheSize`, `SAY_THE_FOLDER`). Пропущены на `win32`, с причиной в комментарии:
  - «a shell that ignores SIGHUP is killed after the grace period» — SIGHUP на Windows нет;
  - «10 MB of output…» — замер конвейера на macOS средствами `/bin/sh`; ConPTY перерисовывает
    поток по-своему;
  - «open starts $SHELL -l…» — и раньше шёл только на macOS.

  Новые случаи, только `win32`: Windows PowerShell (`worfy-5`, папка Project-а, `TERM_PROGRAM`,
  аргументы), `pwsh` из `Path`, Git Bash по настройке (`worfy-5`, интерактивный login-shell),
  закрытие гасит программу внутри оболочки и программу из `Start-Process`.
- **Как test-ы падали до правки.** Unit `terminal-shell.test.ts` написан первым: `TypeError:
  terminalShell is not a function`; registry на `win32` запускал `/bin/zsh -l` (`expected
  [ { file: '/bin/zsh', … } ]`); закрытие на `win32` не завершалось (timeout 5000 мс — ждало
  SIGHUP); команда набиралась с `\n`. `terminal.test.ts` на ПК до правки: 20 упавших, `File not
  found`.
- **Мутанты.** 33, по одному: все 33 валят test-ы — 21 в `pty.ts` (выбор оболочки, список для
  настроек, закрытие на Windows, Enter команды), 2 в `ipc/terminal.ts`, 8 в `ProjectSettings.tsx`,
  2 в схеме настроек. Мутант «`taskkill` без `/T`» ловит contract test на настоящем pty: программы
  внутри оболочки остаются живы. Остальные 20 мутантов `pty.ts` ловит unit-файл, мутанты окна
  настроек — `test/unit/project-settings-shell.test.tsx`.
- **Windows-ПК** (Gate не запускался — он на bash, Ticket 03):
  - `pnpm lint` — 0, `pnpm typecheck` — 0, `pnpm build` — 0. `pnpm install --frozen-lockfile` для
    этой ветки не повторялся: зависимости не менялись;
  - `pnpm test test/unit/terminal-shell.test.ts test/contract/terminal.test.ts` — exit 0:
    58 passed | 3 skipped. Пропущены три случая, названные выше; четыре случая `win32` выполнены,
    не пропущены: на ПК есть и `pwsh` (псевдоним MSIX), и Git Bash, и `node`;
  - `pnpm test test/unit/project-settings-shell.test.tsx` — exit 0, 7 passed;
  - `pnpm test` — exit 1, как на main: 55 failed | 140 passed файлов, 649 failed | 3281 passed | 33
    skipped. Main `11ca93c`: 53 failed | 140 passed файлов, 661 failed | 3234 passed | 31 skipped.
    Ушло 20 падений: 19 в `terminal.test.ts` и одно в `make-icons.test.ts` (состояние этого
    клона, см. Итог Ticket-а 12). По именам новых восемь:
    - четыре — время под нагрузкой: `check-handoff` и первые test-ы `canvas.test.tsx` и
      `shell-discovery.test.tsx` (`Test timed out in 5000ms`), `e3-sandbox` (15000 мс);
    - три — случаи `reviewer-simplification` в `harness-evals.test.ts`: их добавил в main PR,
      влитый после прогона main, и на Windows они падают так же, как остальные случаи файла;
    - один — новый случай этого Ticket-а в `projects.test.ts`, вместе со всем файлом;
  - в полном прогоне один случай `terminal.test.ts` упал: «a Terminal Node removed from the
    Layout…» — сразу после закрытия pid оболочки снова значился живым. Отдельно файл проходит.
    Вероятная причина: Windows отдаёт освободившийся pid другому процессу, а событие выхода
    приходит через секунду; под нагрузкой полного прогона за эту секунду pid успевает достаться
    другому процессу. Проверка «жив ли pid» в test-ах от этого не защищена;
  - старые shell-test-ы Harness (`harness/bin/tests/*.test.sh`) на Windows оставляют после
    каждого полного прогона семь зависших `bash.exe` (`epic-status` не завершается). За день их
    набралось 35; убраны вручную. К этому Ticket-у не относится — к списку Ticket-а 14.
- **Решение владельца (2026-10-12).** Выбор оболочки живёт в настройках Project-а — подтверждено
  (других настроек у worfy нет, а Project живёт на одной Machine, ADR-0052). Ответ передан
  Session на Mac, запись — в комментарии PR #239.
- **Первый круг ревью (2026-10-12): что показал ПК и что изменено.** Windows 11 26200,
  node-pty 1.1.0, Electron-овский Node; пробы — скрипты в папке `%TEMP%\worfy-01` на ПК, в репозитории их нет.
  - **Пункты 1–3 ревью на ПК подтвердились.** Открыть и закрыть 20 Terminal-ов (Windows
    PowerShell без профиля), счёт по процессу с registry:

    | | потоки ОС | дочерние `conhost.exe` | RSS | `close()` |
    | --- | --- | --- | --- | --- |
    | до правки: старт → после 20 закрытий | 14 → 37 | 0 → 20 | 61 → 219 MB | 1151–1174 мс |
    | после правки: старт → после 20 закрытий | 14 → 14–17 | 0 → 0 | 61 → 76 MB | 580–653 мс |

    До правки через 8 с ничего не уходило: 37 потоков и 20 `conhost.exe` оставались.
  - **Что освобождает псевдоконсоль** (по 10 оболочек на способ, счёт через 7 с):
    - `pty.kill()` при живой оболочке — событие выхода через 61–80 мс, потоков 14, `conhost.exe` 0;
    - `taskkill` дерева, как было, — выход через 1141–1378 мс, +10 потоков, +10 `conhost.exe`;
    - оболочка вышла сама (`exit`) — выход через 1028–1067 мс, +10 потоков, +10 `conhost.exe`.
  - **Помощник node-pty.** `kill()` в node-pty 1.1.0 запускает процесс-помощник, который читает
    список процессов консоли. На ПК он упал 10 раз из 10 (`AttachConsole failed`: консоль
    закрывается раньше), и ровно через 5 с node-pty вызвал `process.kill(<pid оболочки>)` — по
    номеру, кто бы им ни владел к тому времени (замер подменой `process.kill`: 10 вызовов из 10).
    Поэтому помощник убран: `kill()` без него закрывает консоль так же (61–63 мс, потоков 14,
    `conhost.exe` 0) и не трогает ни одного pid.
  - **Кто переживает закрытие консоли.** После `pty.kill()` без помощника: оболочка и программа,
    которую она ждёт (`node` на её консоли), исчезают сразу; программа из `Start-Process
    -WindowStyle Hidden` жива и через 6 с. Поэтому процессы под оболочкой гасятся отдельно, до
    консоли.
  - **Скрипт `endDescendants` вместо `taskkill`.** Один список процессов (`Win32_Process`:
    pid, родитель, время создания), обход вниз от оболочки. Оболочка не считается «той самой»,
    если процесс с её pid создан позже, чем registry её запустил: тогда скрипт отвечает `gone` и
    не гасит никого. Процесс старше своего «родителя» ребёнком не считается (его настоящий
    родитель имел этот pid раньше) — `taskkill /T` такого не проверяет. Что не удалось
    погасить, попадает в лог (`ended <n> of <найдено>`).
  - **`-EncodedCommand` стоит секунды.** Тот же скрипт через `-EncodedCommand` шёл 2267–3268 мс
    при каждом новом тексте (а текст меняется с pid и временем), повтор того же текста — 440–470 мс;
    через `-Command` — 435–492 мс всегда. Так было только из Electron-овского Node; из обычного
    Node — 430–500 мс в обоих видах. Скрипт передаётся через `-Command`, двойных кавычек в нём
    нет. Причина разницы не выяснялась.
  - **Верхняя граница.** Помощнику дано 3 с, всему закрытию — 5 с: после этого зовётся
    `pty.kill()`, Terminal считается закрытым (код выхода 1), а запоздавшее событие выхода от
    node-pty ничего не меняет. `will-quit` после своего ожидания больше не задерживает следующий
    выход — раньше каждая новая попытка откладывалась заново.
  - **Оболочка, вышедшая сама** (`exit`): теперь получает `pty.kill()` без помощника — рабочий
    поток node-pty останавливается (20 выходов: потоков 14 → 14). **`conhost.exe` при этом
    остаётся** до выхода worfy: 20 выходов — 20 `conhost.exe`, до правки и после. node-pty 1.1.0
    забывает псевдоконсоль в момент выхода оболочки (`src/win/conpty.cc`, `remove_pty_baton`), и
    закрыть её через его API уже нельзя. Не исправлено; это кандидат в отдельный Ticket
    (обновление node-pty или `useConptyDll`).
  - **Остальные пункты ревью.**
    - 4: настройки Project-а для Terminal читаются только на Windows и только при старте оболочки;
      не читаются — стартует PowerShell со строкой в лог.
    - 5: неизвестный `terminalShell` не роняет `settings.json`, шаблоны действий остаются.
    - 7: поиск `pwsh` пропускает записи `Path`, не являющиеся полным путём, папку с именем
      `pwsh.exe` и ссылку в никуда — и идёт дальше, до Windows PowerShell. Псевдоним MSIX
      узнаётся по тому, что `readlink` называет настоящий файл (на ПК: `stat` псевдонима —
      EACCES, `readlink` — `C:\Program Files\WindowsApps\…\pwsh.exe`, `stat` цели — файл).
      Правка в общем `findOnPath` (`src/main/agent/env.ts`), им же ищется `git`.
    - 9: `LANG=en_US.UTF-8` на Windows в оболочку больше не добавляется. Git Bash с `LANG` и
      без него на ПК не сравнивался.
    - 10: Git Bash ищется ещё в `%ProgramFiles(x86)%\Git`; реестр не спрашивается.
    - 11: «Reset to default» сбрасывает шаблоны и оставляет выбранную оболочку — закреплено
      test-ом и комментарием.
    - 13: случай «SIGKILL не уходит, если оболочка вышла за время ожидания» для macOS добавлен.
    - 8 (коды выхода `taskkill`) отпал вместе с `taskkill`; его место занял счёт
      `ended <n> of <найдено>`.
  - **Вопрос владельцу из ревью остаётся открытым:** закрытие Terminal гасит и оконные программы,
    запущенные из него (редактор, браузер), без запроса на закрытие. Другие терминалы Windows
    их оставляют. Ticket требует гасить дерево; если владелец решит иначе, шаг `endDescendants`
    убирается, остаётся `pty.kill()`.
  - **Windows-ПК после правок**, на слиянии с main `f9c005b` (Gate не запускался — он на bash):
    - `pnpm lint` — 0, `pnpm typecheck` — 0; `pnpm build` и `pnpm install` в этом круге не
      повторялись;
    - четыре файла Ticket-а (`terminal-shell`, `terminal-wiring`, `project-settings-shell`,
      contract `terminal`) — exit 0: 107 passed | 3 skipped;
    - `pnpm test` — exit 1, как на main: 51 failed | 147 passed файлов, 682 failed | 3404 passed |
      33 skipped. Main `f9c005b` в тот же час: 52 failed | 143 passed файлов, 701 failed | 3313
      passed | 31 skipped. По именам: новый один — случай этого Ticket-а в `projects.test.ts`
      (файл падает целиком и на main); ушло 20 — все в `terminal.test.ts`;
    - в логе двух файлов Terminal нет ни одной строки `AttachConsole failed` (до правки — на
      каждое закрытие);
    - один сбой без причины: в одном из шести прогонов `terminal.test.ts` старый случай «open
      starts Windows PowerShell…» не нашёл строку `tp=worfy term=…` в выводе за 5 с. Код случая
      в этом круге не менялся; что было в выводе, не сохранилось.
  - **Мутанты после правок.** 83, по одному; все 83 валят test-ы.
    - Первый прогон оставил двух: «запоздавший выход сообщается» (test не слушал экран новой
      оболочки) и «`kill()`, бросивший исключение, останавливает закрытие» (прогон падал только
      необработанной ошибкой, без упавшего test-а). Test-ы усилены, оба мутанта красные.
    - Из мутантов текста скрипта два («гасится и сама оболочка», «никто не гасится») ловят только
      Windows-test-ы на настоящих процессах, а один («процесс старше родителя принят за ребёнка»)
      — только закрепление текста скрипта.
- **Второй круг ревью (2026-10-12).**
  - **1. Запас времени при опознании оболочки.** Замер на ПК (`probe-startedby.cjs`, Node 24.21.0
    из Electron 44.5.1, 200 запусков оболочки через node-pty): время создания процесса раньше
    `startedBy` на 0,59–6,75 мс (медиана 1,27 мс), позже — ни разу; сам запуск занимает 27–44 мс.
    Интервал таймера Windows в этот момент — 1 мс (самый грубый 15,625 мс, самый тонкий 0,5 мс,
    читано через `NtQueryTimerResolution`): работали Chrome, Claude, Discord, Edge, Slack, Spotify.
    Программы владельца я не закрывал, поэтому при таймере 15,6 мс замера нет. Запас расширен с
    1 до 100 мс (`SHELL_START_SLACK_MS`). Если скрипт ответил `gone`, а node-pty о выходе не
    сообщал, в лог идёт строка с pid.
  - **2. Время старта, уходящее в скрипт, закреплено:** в test-е запуск «занимает» 7 мс, а
    закрытие идёт через час; ждём момент сразу после запуска.
  - **3. Текст скрипта закреплён целиком**, построчно, для одной оболочки: любая его правка
    падает в Linux CI и требует нового прогона на Windows.
  - **4. Процесс на два уровня ниже оболочки:** test на настоящем pty (оболочка → `cmd.exe` в
    своём окне → `node`); после `close()` нет ни одного из трёх.
  - **5.** pty, который закрыт и уже «вышел» (сам или по границе 5 с), больше ничего не
    рассылает: его вывод не попадёт на экраны новой оболочки того же Node. Оболочка, вышедшая
    сама, хранит и то, что допечатала после выхода, — как раньше.
  - **6.** Событие выхода без кода (после `kill()` на Windows) уходит экранам как 1.
  - **7.** Нет приватного метода node-pty — строка в лог; test для любой системы читает
    `lib/windowsPtyAgent.js` и упадёт в CI при обновлении node-pty.
  - **8.** Скрипт называет pid тех, кого не удалось погасить (`ended <n> of <найдено> left <pid>`);
    процесс, который сам завершился между проверками, считается погашенным; `kill()`, бросивший
    исключение, оставляет строку в логе.
  - **9.** Все сравнения времени в скрипте — в UTC. Час, который при осеннем переводе часов идёт
    дважды, .NET читает как зимнее время; этот случай не проверялся.
  - **10.** Выход из worfy на Windows ждёт оболочки 6 с (на секунду дольше границы закрытия),
    на остальных системах 3 с, как раньше. Оборванное ожидание пишется в лог. Пропуск «следующего
    quit» действует один раз; `will-quit` во время ожидания тоже задерживается.
  - **11–13.** Закреплены: где ставится пропуск quit, значения границ, проверка «это функция» в
    `withoutConsoleHelper`, ссылка `pwsh.exe` на папку, поздний ответ `terminal.shells` для другого
    Project-а. pid подменных pty — вида 999 99x xxx. В `agent-env.test.ts` — строки на
    изменённый поиск и случай на настоящих папках Windows.
  - **Windows-ПК после второго круга,** на 6906e3f плюс этот круг (main `d803f93` внутри; Gate не запускался):
    - `pnpm lint` — 0, `pnpm typecheck` — 0;
    - пять файлов Ticket-а — exit 0: 180 passed | 7 skipped (`terminal-shell` 51, `terminal-wiring` 3,
      `project-settings-shell` 11, `agent-env` 61 и 4 пропущенных случая других систем, contract
      `terminal` 54 и 3 пропущенных);
    - `pnpm test` — exit 1: 51 failed | 147 passed файлов, 679 failed | 3422 passed | 33 skipped. По
      именам против main `f9c005b`: новый один (случай Ticket-а в `projects.test.ts`), ушло 23 — 20
      в `terminal.test.ts`, 2 в `startup-failure.test.ts` и 1 в `e3-sandbox.test.ts` (последние три
      падают или проходят в зависимости от нагрузки прогона).
  - **Мутанты после второго круга.** 114, по одному; все 114 валят test-ы: 83 из списка первого круга
    (десять переписаны под изменённые строки) и 31 новый. Первый прогон оставил одного — «граница
    не зовёт pty»: с убранным помощником pty зовёт и сам выход, который граница сообщает; test
    границы теперь берёт pty без помощника, мутант красный. «Гасятся только прямые дети»
    прогонялся на одном contract-файле, без закрепления текста: его валит test с внуком.
- **Ждёт Mac** (раздел «Mac checks» PR): `test/contract/terminal.test.ts` и e2e
  `test/e2e/terminal.spec.ts` с прежними ожиданиями; новый случай в `test/contract/projects.test.ts`
  (на Windows этот файл падает целиком и на main); в окне настроек Project-а поля оболочки нет.
- **Не проверено.**
  - В окне приложения ничего не открывалось: новый Terminal Node с PowerShell, Restart с Git Bash,
    закрытие Terminal Node — ручной пункт владельца.
  - Windows 10 21H2: ConPTY и скрипт `endDescendants` проверены на одной машине, Windows 11 26200.
  - Повторная выдача pid: правила «оболочка создана не позже старта» и «ребёнок не старше
    родителя» проверены подменой времени старта, настоящего повторного pid в test-ах нет.
  - PowerShell в режиме Constrained Language и политика, запрещающая `powershell.exe`: тогда
    `endDescendants` падает, в лог идёт строка, и закрывается только консоль.
  - Программа, которая после закрытия консоли продолжает в неё писать (пункт 1b ревью): не
    воспроизводилась; её закрывает граница 5 с.
  - Упакованное приложение: замеры шли в Electron-овском Node из `node_modules`, не в `worfy.exe`.
  - Terminal на Linked machine под Windows.
  - Shell integration (подсказки Terminal AI) на Windows нет: она только для zsh.
  - Профиль PowerShell пользователя в Terminal worfy: test-ы идут с `-NoProfile`.
  - `test/contract/projects.test.ts` на Windows: новый случай там красный вместе со всем файлом
    (38 из 41 падают на main: «call rejected, it came from an untrusted frame»).
