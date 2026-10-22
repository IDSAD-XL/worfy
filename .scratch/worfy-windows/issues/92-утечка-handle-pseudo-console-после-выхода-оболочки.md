# 92 — Terminal на Windows: два handle на каждую оболочку, которая кончилась не через close Terminal-а

Type: task
Status: open
Blocked by: —
Source: «Итог» [Ticket-а 42](42-остатки-ревью-pr-280.md), пункт 8 (PR #737); направление Session на Mac
2026-10-22: сначала замер, потом Ticket. Замер на ПК 2026-10-22, строки — по main `343be106`.

## Что происходит

Каждая оболочка Terminal-а на Windows, которая кончилась сама (`exit`) или была убита снаружи, оставляет в
процессе worfy (main) два handle:

- handle типа `Process` на уже завершённый `OpenConsole.exe` — хост консоли пакета node-pty (`useConptyDll`);
- handle типа `File` — pipe.

Они живут до выхода worfy. Число растёт линейно с числом таких оболочек, без потолка. Потоки и процессы не
копятся: `OpenConsole.exe` под процессом после каждого шага — 0, потоков 13–16 всё время.

Git Bash теряет те же два handle и при обычном закрытии Terminal-а (`terminal.close`). PowerShell при
закрытии не теряет ничего.

Причина — в node-pty 1.2.0-beta.15. Поток, который ждёт выхода оболочки, удаляет запись pty
(`pty_baton`) из списка `ptyHandles`. Pseudo-console (`HPCON`) он при этом не закрывает. Потом `kill()`
не находит записи и тоже ничего не закрывает. Закрыть pseudo-console может только
`ConptyClosePseudoConsole`, и вызывает его только `kill()` — пока запись ещё есть.

## Доказательства (замер на ПК, 2026-10-22)

Probe: настоящий `TerminalRegistry` из `src/main/terminal/pty.ts` (node-pty с `useConptyDll`, как в
приложении), под Electron из репозитория как Node (`ELECTRON_RUN_AS_NODE=1`, `--expose-gc`). Оболочки
стартуют с временным профилем: USERPROFILE, APPDATA, LOCALAPPDATA, HOME, HOMEDRIVE, HOMEPATH указывают на
временную папку. PowerShell — Windows PowerShell 5.1 с `-NoProfile`. Git Bash — 5.2.26 из
`C:\Program Files\Git\bin\bash.exe`.

Как оболочка кончается:

- `exit` — набрать `exit`, дождаться выхода, потом `registry.close`;
- `close` — `registry.close` у работающей оболочки, то есть закрыть Terminal;
- `kill` — `TerminateProcess` pid оболочки снаружи (`process.kill`), потом `registry.close`.

Handle процесса считает `92-handles.ps1` через `NtQuerySystemInformation`: всего, по типу объекта, цель
каждого handle типа `Process`, тип файла каждого handle типа `File`. `handle.exe` Sysinternals на ПК нет.
Итог каждый раз совпал с `(Get-Process -Id <pid>).HandleCount`. Перед каждым замером probe ждёт 3 с
(`dispose()` потока вывода node-pty срабатывает через 1000 мс) и вызывает `gc()`.

| Шаг (оболочек) | PowerShell | Git Bash | Из чего прирост |
| --- | --- | --- | --- |
| старт | 235 | 235 | — |
| `exit` ×10, прогрев | +29 | +29 | 10 `Process`, 11 pipe, 1 disk, 7 `EtwRegistration` (разово) |
| `exit` ×20 | +41 | +41 | 20 `Process`, 20 pipe; `Event` +1, `Thread` +1, `ALPC Port` −1 |
| `close` ×20 | **+0** | **+40** | Git Bash: 20 `Process`, 20 pipe |
| `kill` ×20 | +40 | +40 | 20 `Process`, 20 pipe |
| `exit` ×100, по 4 сразу | +200 | +200 | 100 `Process`, 100 pipe |

Каждый новый handle типа `Process` указывает на завершённый процесс. Это `OpenConsole.exe` той же
оболочки, а не сама оболочка. probe записал pid хоста консоли у первых двух оболочек каждого шага:

- PowerShell `exit` s1 — `OpenConsole.exe` 58048, утёк handle `0x378` на завершённый 58048;
- PowerShell `kill` s51/s52 — 52620 и 23200, оба в списке утёкших;
- Git Bash `close` s32 — 58568, тоже в списке.

Pid самих оболочек среди утёкших нет ни разу.

Ticket 42 мерил другим способом и получил то же: 282 → 322 после 20 оболочек (+40), → 682 после 200 (+400).
Его контроль — PowerShell, закрытая реестром: +1.

Что за pipe: скорее всего, это `hSignal` из `HPCON`. По исходникам Windows Terminal
(`src/winconpty/winconpty.cpp`; здесь не перечитаны) `HPCON` хранит три handle: `hSignal` (pipe),
`hPtyReference` и `hConPtyProcess` (процесс `OpenConsole.exe`). `ConptyReleasePseudoConsole` сразу после
старта (`conpty.cc:458`) закрывает `hPtyReference`. Два других закрывает только
`ConptyClosePseudoConsole`. Это объясняет ровно два handle: один pipe и один процесс.

Почему Git Bash теряет handle и при закрытии. Это вывод из кода и дерева процессов, отдельно не замерено.

- Оболочка Git Bash — запускатель `bin\bash.exe`, под ним настоящий `usr\bin\bash.exe`. probe видел дерево
  `bash.exe:58736<58176`, `bash.exe:60852<58736`.
- `close` сначала завершает всё под оболочкой (`endDescendants`), то есть и настоящий bash.
- Запускатель выходит сам вслед за ним. Поток выхода node-pty удаляет запись pty до того, как `release()`
  зовёт `kill()`.
- У PowerShell под оболочкой ничего нет, и `kill()` застаёт запись живой.

Как повторить. Probe — [`92-probe.ts`](../evidence/92-probe.ts) и [`92-handles.ps1`](../evidence/92-handles.ps1).
Сборка и запуск описаны в шапке `92-probe.ts`. Шаги замера:

```
… probe.cjs leak <out> powershell "exit:10,exit:20,close:20,kill:20,exit:100:4"
… probe.cjs leak <out> git-bash   "exit:10,exit:20,close:20,kill:20,exit:100:4"
```

Один прогон — 170 оболочек, 2–2,5 минуты.

**Растёт ли без предела.** Да: два handle и один объект завершённого процесса на оболочку, до выхода
worfy. Плато нет: 100 оболочек дали ровно +200. Предел handle процесса Windows (2^24) так не достать. Но
каждый завершённый `OpenConsole.exe` держит в ядре объект процесса и свой pid, пока жив handle. За долгую
сессию с частым `exit` или с Git Bash это сотни штук.

## Что делаем

Варианты. Выбор — за Session на Mac и владельцем.

1. **Патч node-pty.** В потоке выхода (`conpty.cc:95-104`) закрыть pseudo-console
   (`ConptyClosePseudoConsole` / `ClosePseudoConsole`), прежде чем удалить запись. Или оставить запись до
   `kill()` и закрыть её там. Заодно — issue или PR в `microsoft/node-pty`. Есть ли исправление в версии
   новее 1.2.0-beta.15, не проверено.
   Цена высокая. Сейчас на Windows ставится готовый `conpty.node` (postinstall: «node-pty uses its prebuilt
   win32 binary; no rebuild on Windows»). Патч требует собирать его под ABI Electron 44: VS Build Tools,
   node-gyp, `pnpm patch`. Ту же сборку нужно повторять при каждом обновлении Electron и node-pty.
2. **Ждать исправления upstream и обновить node-pty.** Правки сейчас нет, утечка остаётся.
3. **Только для Git Bash, со стороны worfy: не дать запускателю выйти раньше `kill()`.**
   - Вариант (а): запускать `usr\bin\bash.exe` напрямую. Цена: повторить окружение, которое ставит
     запускатель (`MSYSTEM`, `PATH` с `mingw64\bin` и т. д.), и проверить, что `--login -i` даёт ту же
     оболочку.
   - Вариант (б): `endDescendants` не трогает прямого ребёнка запускателя, а его завершает закрытие
     консоли. Цена: особый случай в скрипте помощника и в его test-е с полным текстом.

   Это убирает утечку при `close` у Git Bash. `exit` и `kill` остаются, как у PowerShell.
4. **Принять и записать.** Утечка ограничена числом оболочек, которые пользователь закрыл через `exit`, и
   уходит с выходом worfy. Цена — ноль. Остаток — сотни объектов процессов за долгую сессию.

Вариант 3 связан с [Ticket-ом 93](93-git-bash-теряет-историю-при-закрытии-terminal-а.md). Если Git Bash
получит SIGHUP перед закрытием, он выйдет сам ещё до `kill()`, и при `close` утечка будет и без
`endDescendants`. Решать их вместе.

## Готово, когда

- [ ] Probe `92-probe.ts` на ПК: `exit:100:4` у PowerShell и у Git Bash даёт прирост handle не больше +5.
      `close:20` у Git Bash — не больше +2.
- [ ] Contract test на Windows (`test/contract/terminal-windows.test.ts`): 20 оболочек через `exit` —
      `HandleCount` процесса растёт не больше чем на 5. Test красный без правки.
- [ ] `OpenConsole.exe` под процессом после шагов — 0, как сейчас.
- [ ] `pnpm lint`, `pnpm typecheck` — exit 0. На Mac Terminal-ы не меняются.

Или, если выбран вариант 4: решение записано в ADR или в `docs/lessons/`, и Ticket закрыт без правки.

## Где в коде

- `node_modules/node-pty` 1.2.0-beta.15, `src/win/conpty.cc`:
  - `:95-104` — поток выхода: `WaitForSingleObject(hShell)`, `CloseHandle(hShell)`, `erase_if(ptyHandles…)`,
    без `ClosePseudoConsole(hpc)`;
  - `:225` — создание `HPCON`;
  - `:455-458` — `ConptyReleasePseudoConsole`;
  - `:570` — `PtyKill` ищет запись (после выхода её нет);
  - `:582` — `ClosePseudoConsole(hpc)`;
  - `:596` — `TerminateProcess(hShell)`.
- `node_modules/node-pty/lib/windowsPtyAgent.js:206-213` — `kill()` при `useConptyDll`: `inSocket.destroy()`,
  нативный `kill`, `dispose()` потока вывода по первым данным.
- `src/main/terminal/windows-pty.ts:177` — `spawnWindowsPty`, `useConptyDll: true`.
- `src/main/terminal/pty.ts`:
  - `:600` — `finish()` зовёт `release(terminal, true)` после выхода;
  - `:929-946` — `release()`, `terminal.pty.kill()` на `:941`;
  - `:864`, `:902-915` — `close()` → `endWindowsShell()`: сначала `endDescendants`, потом `release`.
- `src/main/terminal/windows-pty.ts:95`, `:116` — `endDescendants`, `Stop-Process -Force` всего под оболочкой
  (у Git Bash это настоящий `usr\bin\bash.exe`).
- `src/main/terminal/pty.ts:154` — Git Bash стартует как `bin\bash.exe --login -i`.

## Вне скоупа

- История Git Bash при закрытии Terminal-а — [Ticket 93](93-git-bash-теряет-историю-при-закрытии-terminal-а.md).
- Консоль системы (`useConptyDll: false`) приложение не использует. Её утечку `conhost.exe` закрыл Ticket 22.
