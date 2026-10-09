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

- [ ] Unit `test/unit/terminal-shell.test.ts` (новый): `win32`, PowerShell, `pwsh.exe` в `Path` →
  `pwsh.exe` и `['-NoLogo']`; `pwsh.exe` — псевдоним MSIX в `WindowsApps` (`existsSync` — false,
  `lstat` — symlink) → тоже `pwsh.exe`; без `pwsh` → `…\WindowsPowerShell\v1.0\powershell.exe`; Git Bash →
  `bash.exe` и `['--login', '-i']`; Git Bash выбран, но не найден → PowerShell; `darwin` →
  `$SHELL -l`, без `SHELL` — `/bin/zsh -l`.
- [ ] Unit (`TerminalRegistry` с подменённым `spawn`): на `win32` `close` вызывает функцию, которая
  гасит дерево, с `pid` оболочки, затем `pty.kill()` без аргумента, и не вызывает `process.kill` с
  отрицательным `pid`; на `darwin` — SIGHUP группе и SIGKILL после `KILL_GRACE_MS`, как сейчас.
- [ ] Contract `test/contract/projects.test.ts`: `settings.json` без `terminalShell` читается без
  поля; `projects.settings.set` с `git-bash` сохраняет его; неизвестное значение отвергается схемой.
  Contract `terminal.shells`: на `darwin` — пустой список.
- [ ] `test/contract/terminal.test.ts`, test для `win32` на настоящем pty, на Windows-ПК:
  - PowerShell: ввод `Write-Output "worfy-$(2+3)"` печатает `worfy-5`;
  - Git Bash: ввод `echo "worfy-$((2+3))"` печатает `worfy-5`;
  - в PowerShell запущен `node -e "console.log('pid=' + process.pid); setInterval(() => {}, 1000)"`;
    после `terminal.close` процесса с этим pid нет (`process.kill(pid, 0)` бросает `ESRCH`) не позже
    `KILL_GRACE_MS` + 1 s. То же для процесса, запущенного через `Start-Process`.
- [ ] Windows-ПК: `pnpm test test/unit/terminal-shell.test.ts test/contract/terminal.test.ts` —
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

Заполняется при закрытии.
