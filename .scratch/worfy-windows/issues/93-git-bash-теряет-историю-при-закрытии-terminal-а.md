# 93 — Git Bash на Windows теряет историю команд, когда Terminal закрывают

Type: task
Status: open
Blocked by: —
Source: «Итог» [Ticket-а 42](42-остатки-ревью-pr-280.md), пункт 8 (PR #737); направление Session на Mac
2026-10-22: сначала замер, потом Ticket. Замер на ПК 2026-10-22, строки — по main `343be106`.

## Что происходит

Пользователь набирает команды в Git Bash в Terminal-е worfy и закрывает Terminal: удаляет Node, закрывает
Project или выходит из worfy. `~/.bash_history` после этого не записан, команд этой сессии в нём нет. Если
выйти через `exit`, история пишется.

Bash пишет историю в файл только при выходе: после `exit`, на EOF или по SIGHUP. worfy на Windows не делает
ничего из этого. Закрытие завершает bash через `TerminateProcess`:

1. `close()` → `endWindowsShell()`. Помощник `endDescendants` делает `Stop-Process -Force` всего под
   оболочкой. Оболочка Git Bash — запускатель `bin\bash.exe`, и настоящий `usr\bin\bash.exe` — его ребёнок,
   поэтому он завершается первым.
2. Затем `release()` → `kill()` node-pty. Тот закрывает pseudo-console и делает `TerminateProcess` запускателя
   (`conpty.cc:596`).

Закрыть консоль, не убивая bash, тоже не помогает, см. замер ниже. Bash на Windows от этого не получает
SIGHUP вовремя.

Сравнение с macOS и Linux — по коду, **там не замерено**. `close()` шлёт SIGHUP группе процессов оболочки
(`pty.ts:878-879`), через `KILL_GRACE_MS` = 1000 мс — SIGKILL (`pty.ts:80`, `:881`). Интерактивный bash по
SIGHUP сохраняет историю. zsh по SIGHUP выходит и пишет `HISTFILE`. worfy оставляет `HISTFILE` пользователю
(`src/main/terminal/zsh/zshrc.zsh:8-9`). Значит, там история при закрытии должна сохраняться, если оболочка
успевает за 1 с.

PowerShell этот Ticket не касается: PSReadLine пишет историю после каждой команды. Здесь это не замерено.

## Доказательства (замер на ПК, 2026-10-22)

Probe: настоящий `TerminalRegistry` из `src/main/terminal/pty.ts`, под Electron из репозитория как Node.
Git Bash — 5.2.26 (Git for Windows, `C:\Program Files\Git\bin\bash.exe --login -i`). У каждого случая свой
временный профиль: USERPROFILE, APPDATA, LOCALAPPDATA, HOME, HOMEDRIVE, HOMEPATH — в новой папке. Git Bash
берёт HOME из HOMEDRIVE+HOMEPATH, так что `~/.bash_history` — в ней.

В каждом случае Git Bash получает `echo probe-one-$((40+2))` и `echo probe-two-$((40+2))`, probe ждёт их
вывода, потом заканчивает оболочку и через 0,5 с смотрит `~/.bash_history`.

| Случай | Как закончилась | `.bash_history` | Время |
| --- | --- | --- | --- |
| `close` (как в приложении) | `registry.close` | **нет файла** | 739 мс |
| `exit` (контроль) | `exit`, затем `registry.close` | 55 байт, обе команды | 171 мс |
| `prompt-command-close` | `registry.close`; в окружении `PROMPT_COMMAND='history -a'` | 50 байт, обе команды | 684 мс |
| `hup-then-close` | `usr\bin\kill.exe -HUP -W <pid настоящего bash>`, затем `registry.close` | 50 байт, обе команды; bash вышел сам через 112 мс | 112 мс |
| `system-console-close` | консоль системы (`useConptyDll: false`), `registry.close` | нет файла | 1641 мс |
| `system-console-close-no-descendants` | консоль системы, `endDescendants` пустой: только `ClosePseudoConsole`, без `TerminateProcess` | нет файла | 62 мс |
| `package-console-close-no-descendants` | консоль пакета, `endDescendants` пустой: `ConptyClosePseudoConsole` и `TerminateProcess` запускателя | нет файла | 65 мс |

Дерево процессов каждой оболочки — запускатель под worfy и bash под ним, например `bash.exe:58736<58176`,
`bash.exe:60852<58736`.

Выводы:

- **Закрытие консоли не даёт bash сохранить историю** — ни консоли пакета, ни консоли системы, даже без
  `TerminateProcess` от node-pty. Это последние два случая.
- Историю сохраняют три пути: `exit`, сигнал SIGHUP через рантайм MSYS (`kill -HUP -W`) и `history -a` в
  `PROMPT_COMMAND`.

Ticket 42 видел то же на консоли пакета и на консоли системы: файла нет, `history` новой оболочки не знает ни
одной из трёх команд. С `exit` файл есть.

Как повторить. Probe — [`92-probe.ts`](../evidence/92-probe.ts), режим `history`; сборка описана в его шапке:

```
… probe.cjs history <out>
```

Семь оболочек, около 20 с.

## Что делаем

Варианты. Выбор — за Session на Mac и владельцем.

1. **SIGHUP через MSYS перед закрытием** (замерено: работает, bash выходит сам за 112 мс). Для Git Bash
   `endWindowsShell` сначала запускает `<корень Git>\usr\bin\kill.exe -HUP -W <pid>` настоящего bash — ребёнка
   запускателя. Потом ждёт выхода, например до 1000 мс, как `KILL_GRACE_MS` на macOS. Если bash не вышел, идёт
   нынешний путь.
   - Поведение совпадает с macOS: SIGHUP получают и задания оболочки (`huponexit` и прочее — как у bash там).
   - Цена: ещё один процесс на закрытие (около 0,1 с). Нужен pid настоящего bash: помощник
     `endDescendants` уже обходит дерево, но в нынешнем виде его не отдаёт. Корень Git берётся из пути
     оболочки (`bin\bash.exe` → `..\usr\bin\kill.exe`).
   - Новый test-текст помощника. `trap '' HUP` у пользователя — откат на нынешний путь после ожидания.
   - Заодно bash выходит сам до `kill()`. Это связано с утечкой handle при закрытии Git Bash —
     [Ticket 92](92-утечка-handle-pseudo-console-после-выхода-оболочки.md), вариант 3.
2. **`PROMPT_COMMAND='history -a'` в окружении Git Bash** (замерено: работает). Цена — одна переменная в
   `terminalEnv` для Git Bash.
   - Пределы: `PROMPT_COMMAND` из `.bashrc` пользователя её заменяет, и история снова теряется. Если
     пользователь задаёт `PROMPT_COMMAND` через окружение, worfy заменит его значение.
   - Команда, которая шла в момент закрытия, не записывается: запись — перед следующим приглашением.
   - История нескольких Terminal-ов перемешивается в файле по времени — так у многих и настроено.
3. **Закрыть консоль, не убивая bash** (замерено: **не работает**). Без `TerminateProcess` и без
   `endDescendants` история всё равно теряется — на обеих консолях. Отвергнуто.
4. **Набрать `exit` в оболочку перед закрытием.** Не замерено и не надёжно: если идёт программа, `exit`
   достаётся ей. Отвергнуто.

## Готово, когда

- [ ] Contract test на Windows, только при найденном Git Bash: две команды, `terminal.close`, во временном
      HOME есть `.bash_history` с обеими. Test красный без правки (`close` сейчас — нет файла).
- [ ] Probe `92-probe.ts history`: случай `close` пишет историю. `exit` — как раньше.
- [ ] Закрытие Terminal-а с Git Bash по-прежнему завершает всё под оболочкой: test-ы `endDescendants` и
      закрытия зелёные.
- [ ] На Mac поведение не меняется: SIGHUP группе, как сейчас.
- [ ] `pnpm lint`, `pnpm typecheck` — exit 0.

## Где в коде

- `src/main/terminal/pty.ts`:
  - `:846`, `:864` — `close()` на Windows → `endWindowsShell()`;
  - `:902-915` — `endWindowsShell()`: `endDescendants` (`:906`), потом `release(terminal, false)` (`:915`);
  - `:929-946` — `release()`, `terminal.pty.kill()` на `:941`.
- `src/main/terminal/windows-pty.ts`:
  - `:58-103`, `:116` — `descendantsScript` / `endDescendants`; `Stop-Process -Force` на `:95`;
  - `:177` — `useConptyDll: true`.
- `node_modules/node-pty` 1.2.0-beta.15:
  - `src/win/conpty.cc:582` — `ClosePseudoConsole`, `:596` — `TerminateProcess(hShell, 1)`;
  - `lib/windowsPtyAgent.js:206-213` — `kill()` при `useConptyDll`.
- `src/main/terminal/pty.ts:154` — Git Bash как `bin\bash.exe --login -i` (запускатель, bash — его ребёнок).
- `src/main/terminal/pty.ts:106` — `terminalEnv` (место для варианта 2).
- macOS и Linux для сравнения:
  - `src/main/terminal/pty.ts:876-884` — SIGHUP группе, SIGKILL через `KILL_GRACE_MS` (`:80`);
  - `src/main/terminal/zsh/zshrc.zsh:8-9` — `HISTFILE` пользователя.
- `test/e2e/terminal-shell.ts:15` — e2e с Git Bash набирают `unset HISTFILE`. Test варианта 1 или 2 не должен
  на это опираться.

## Вне скоупа

- Утечка handle pseudo-console — [Ticket 92](92-утечка-handle-pseudo-console-после-выхода-оболочки.md).
- Замер истории zsh и bash при закрытии Terminal-а на macOS и Linux — здесь не делался. Если нужен, он для
  Session на Mac.

## Итог

Сделан вариант 1 (SIGHUP через MSYS) вместе с вариантом 3 Ticket-а 92 (`kill()` до выхода запускателя).
Коммит `ff47f5b0` на ветке `worfy-windows/93` от `origin/main` a371aa41.

**Новый порядок закрытия Git Bash** — в помощнике `endDescendants` (`src/main/terminal/windows-pty.ts`,
`hangupLines`), один процесс Windows PowerShell, как раньше:

1. обход дерева под оболочкой, как раньше;
2. запускатель `bin\bash.exe` приостанавливается (`NtSuspendProcess` через динамический P/Invoke, без
   `Add-Type`); не вышло — строка `not held` и предупреждение в лог;
3. настоящий `usr\bin\bash.exe` — ребёнок запускателя — получает `kill.exe -HUP -W <pid>` из того же Git for
   Windows (`gitBashKill`: `<корень>\bin\bash.exe` → `<корень>\usr\bin\kill.exe`);
4. ожидание выхода bash до `HANGUP_GRACE_MS` = 1000 мс;
5. `Stop-Process -Force` того, что осталось (bash с `trap '' HUP`, его задания);
6. `release()` → `kill()` node-pty: запускатель приостановлен и не мог выйти сам, запись node-pty о
   pseudo-console жива, `kill()` её закрывает и делает `TerminateProcess` запускателя.

Ожидание 1000 мс: bash выходил через 14–670 мс после сигнала (30 закрытий, большинство до 60 мс); ожидание
кончается, как только bash вышел, целиком его тратит только bash, который сигнал не берёт. 1000 мс — это
`KILL_GRACE_MS` macOS и Linux, и помощник остаётся внутри `DESCENDANTS_TIMEOUT_MS` = 3000 мс. PowerShell,
macOS и Linux не меняются: без `hangup` текст скрипта прежний (закреплён в `test/unit/terminal-shell.test.ts`).

**Почему нужна приостановка.** Замер порядков (probe на настоящем `TerminalRegistry`, Git Bash, свой
временный профиль у каждой оболочки, ПК 2026-10-22):

| Порядок | История | Прирост handle |
| --- | --- | --- |
| как в main: `Stop-Process`, потом `kill()` | нет файла, 0 из 10 | +21 на 10 |
| `Stop-Process`, ждать выхода запускателя, `kill()` | нет файла | +21 на 10 |
| SIGHUP, ждать выхода bash (опрос 5 мс), сразу `kill()` | 10 из 10 | +1 на 10 |
| SIGHUP, ждать выхода bash, `kill()` через 1,5 с | 6 из 6 | +12 на 6 |
| SIGHUP и сразу `kill()`, без ожидания | 5 из 5 | 0 на 5 |
| приостановка запускателя, SIGHUP, ждать выхода bash, `kill()` | 5 из 5 | 0 на 5 |

Без приостановки `kill()` успевает только в гонке: запускатель выходит через миллисекунды после bash, и опрос
`GetExitCodeProcess` из JavaScript иногда видит выход раньше, чем поток выхода node-pty стирает запись
(`conpty.cc:95-104`). Ожидание внутри помощника видит выход только по сигналу объекта процесса — тогда же,
когда его видит поток выхода, — и проигрывает всегда: мутант «SIGHUP без приостановки» даёт +20 на 10.
SIGHUP и сразу `kill()` — тоже гонка: консоль закрывается, пока bash пишет историю.

**До и после** (contract test-ы ниже, 10 Git Bash, `terminal.close`):

| | История после `terminal.close` | Handle на 10 закрытий |
| --- | --- | --- |
| main a371aa41 | нет `.bash_history` | +20 |
| эта ветка | команда в `.bash_history` | 0 ± 5 (3 прогона подряд зелёные) |

Probe `92-probe.ts history` после правки: `close` — 50 байт, обе команды (861 мс; было «нет файла», 739 мс);
`exit` — 55 байт, как раньше. Случай `system-console-close` (консоль системы, `useConptyDll: false`) теперь тоже
пишет историю: `ClosePseudoConsole` системы завершает и приостановленный запускатель. Закрытие Git Bash
длиннее примерно на 0,1 с (`kill.exe` и ожидание bash): 0,76–0,84 с против 0,69–0,75 с.

**Test-ы.**

- `test/contract/terminal-git-bash-close.test.ts` (новый файл; только Windows с Git for Windows, на GitHub
  runner пропуск, как у test-ов с Windows PowerShell 5.1):
  - история: уникальная команда, `terminal.close`, `.bash_history` во временном HOME содержит её;
  - handle: 4 оболочки прогрева, 10 Git Bash по четыре, `terminal.close`, прирост 0 ± 5 по устоявшемуся
    счёту (`handleCount()` из `terminal-harness.ts`, как в test-е Ticket-а 92), консольных хостов не осталось.
- `test/unit/terminal-git-bash-close.test.ts`: `gitBashKill`, порядок строк скрипта (обход → приостановка →
  SIGHUP → ожидание → `Stop-Process`), граница ожидания, экранирование пути `kill.exe`, строка `not held`,
  что registry даёт `hangup` только Git Bash и до `kill()`.

Мутанты: без SIGHUP — красный test истории («.bash_history after the close: expected false to be true»),
handle зелёный; старый порядок (без `hangup`) — красные оба, «added 20 handles»; без приостановки — красный
test handle, «added 20 handles»; unit test registry краснеет на старом порядке.

Проверки: `pnpm lint` 0, `pnpm typecheck` 0, contract test-ы Terminal (`test/contract/terminal*.test.ts`,
`node-pty.test.ts`) 0, unit test-ы Terminal и `no-rmsync` 0, gate fast 0 («[gate] green (fast)»). Файлы истории
владельца (`~\.bash_history`, `ConsoleHost_history.txt`) до и после каждого прогона — те же размер и SHA256.

Не проверено: macOS и Linux (код не менялся); bash, который при закрытии ещё пишет большой HISTFILE дольше
1000 мс, — его доделывает `Stop-Process`, как раньше; Git Bash не из Git for Windows (другой launcher).
