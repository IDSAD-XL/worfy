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
  - **Закрытие на Windows** (`close` → `endTree`): сначала `taskkill /PID <pid> /T /F` из
    `%SystemRoot%\System32`, затем — только если оболочка ещё жива — `pty.kill()` без сигнала.
    Сигналов и группы процессов там нет. Ветка не для Windows — прежний код.
  - **Настройка** `terminalShell: 'powershell' | 'git-bash'` в `projectSettingsSchema`,
    необязательная. main читает её при запуске оболочки (`TerminalDeps.shellSetting`), от renderer
    она не приходит.
  - **Канал `terminal.shells`**: оболочки этой Machine для окна настроек. Не Windows — пустой
    список; Windows — PowerShell (с подписью, какая именно запустится) и Git Bash с признаком
    «найден».
  - **Окно настроек Project-а** показывает поле «Terminal shell», только когда список не пуст;
    сохраняет и шаблоны, и выбор. Пока пользователь не выбрал, поле в файл не пишется.
  - **Команда в Terminal** (`gh auth login` экрана первого запуска, E3 Ticket 19 добавил её после
    того, как Ticket был написан): на Windows набирается с `\r`, не с `\n`. Оболочка после команды
    остаётся открытой, как на Mac.
- **Решения этого Ticket-а.**
  - **Дерево гасит `taskkill`**, свой обход по `ParentProcessId` не писался.
  - **`pty.kill()` после дерева — только если оболочка пережила его.** `taskkill /T /F` уносит и
    саму оболочку. Если после этого позвать `pty.kill()`, node-pty запускает помощника, который
    ищет процессы уже закрытой консоли, и тот печатает в stderr `Error: AttachConsole failed` со
    стеком — на каждое закрытие Terminal. Поэтому `pty.kill()` зовётся, только когда процесс
    оболочки ещё есть (дерево погасить не удалось). Ticket описывал оба шага подряд; порядок
    «сначала дерево» сохранён.
  - **Выбор оболочки — в настройках Project-а** (решение Ticket-а, подтвердить у владельца — ниже).
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
- **Вопрос владельцу.** Выбор оболочки живёт в настройках Project-а (других настроек у worfy нет,
  а Project живёт на одной Machine, ADR-0052). Подтвердить или назвать другое место.
- **Ждёт Mac** (раздел «Mac checks» PR): `test/contract/terminal.test.ts` и e2e
  `test/e2e/terminal.spec.ts` с прежними ожиданиями; новый случай в `test/contract/projects.test.ts`
  (на Windows этот файл падает целиком и на main); в окне настроек Project-а поля оболочки нет.
- **Не проверено.**
  - В окне приложения ничего не открывалось: новый Terminal Node с PowerShell, Restart с Git Bash,
    закрытие Terminal Node — ручной пункт владельца.
  - Windows 10 21H2: ConPTY и `taskkill` проверены на одной машине, Windows 11 26200.
  - Terminal на Linked machine под Windows.
  - Shell integration (подсказки Terminal AI) на Windows нет: она только для zsh.
  - Профиль PowerShell пользователя в Terminal worfy: test-ы идут с `-NoProfile`.
  - `test/contract/projects.test.ts` на Windows: новый случай там красный вместе со всем файлом
    (38 из 41 падают на main: «call rejected, it came from an untrusted frame»).
