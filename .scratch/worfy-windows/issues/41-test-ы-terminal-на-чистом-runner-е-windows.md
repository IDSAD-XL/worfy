# 41 — Test-ы Terminal с настоящей оболочкой не проходят на чистом runner-е Windows

Type: task
Status: blocked
Blocked reason: замер шага 1 — запуск ручного job-а `windows-tests.yml` на ветке `worfy-windows/41-probe`, решение владельца
Waits: owner
Blocked by: —
Source: первый круг ревью PR #280 на Mac, 2026-10-13 ([комментарий в PR #280](https://github.com/IDSAD-XL/worfy/pull/280#issuecomment-6141613079), раздел «The clean Windows runner cannot judge this PR»); логи ручного job-а «Windows tests»: запуск 38364376194 (main) и 38364372348 (ветка PR #280)

## Что происходит

- **Ручной job «Windows tests»** (`.github/workflows/windows-tests.yml`,
  [Ticket 25](25-ручной-job-windows-для-списка-test-файлов.md)) запускает названные test-файлы на
  чистой машине GitHub. В этих запусках: Windows Server 2025 (10.0.26100), образ
  `windows-2025-vs2026` 20260925.250.1, Node 24.21.0, Electron 44.5.1, vitest 5.0.3.
- **Запуск на main:** `test/contract/terminal.test.ts` и `test/unit/terminal-shell.test.ts` — 108
  test-ов: 90 прошло, 15 упало, 3 пропущено. Все 15 — в `terminal.test.ts` (57 test-ов, 140 s).
- **Запуск на ветке PR #280** (три файла): 115 test-ов — 95 прошло, 17 упало, 3 пропущено. Это те
  же 15 и два новых test-а PR на настоящем pty.
- **Что общего у 15 падений** (лог и чтение test-файла):
  - каждый печатает команду в Windows PowerShell — `powershell.exe` из
    `System32\WindowsPowerShell\v1.0` — и ждёт её вывод;
  - 13 ждут 5 s в helper-е `run` (`test/contract/terminal.test.ts:245-248`, ожидание на `:247`);
    два ждут 10 s сами (`:351`, `:980`);
  - в полученном тексте есть старт консоли, заголовок окна, prompt
    `PS C:\Users\runneradmin\AppData\Local\Temp\worfy-terminal-project-…> `, напечатанная команда
    целиком и перевод строки после неё. Вывода команды нет;
  - prompt занимает 74 столбца из 80; команда дорисована с позиции `ESC[1;73H`.
- **Что на том же runner-е проходит:**
  - `pwsh` найден на Path; test с двумя командами через `run` зелёный, 3463 ms;
  - Git Bash: три команды через `run`, зелёный, 6312 ms;
  - `exit 4` и `exit 5`, напечатанные в два Windows PowerShell: оба выхода дошли, весь test занял
    2823 ms (`:494-501`). В test-е «Restart from A» `exit 3` тоже сработал; упал test позже, на
    `run` (`:620`);
  - test-ы, которые закрывают оболочку и ничего не печатают.
- **Ещё из лога.** В первом test-е файла helper worfy `powershell.exe -NoProfile -NonInteractive`
  (`endDescendants`) дважды остановлен по пределу времени: `killed: true`, `signal: 'SIGTERM'`.
  Предел — 3 s (`DESCENDANTS_TIMEOUT_MS`, `src/main/terminal/pty.ts:61`). Дальше таких строк нет.
- **Чего в логе нет:** версии PowerShell (ревью называет её 5.1); слова PSReadLine; времени, через
  которое вывод команды пришёл бы.
- **Что лог говорит о трёх догадках.**
  - «На Path runner-а нет `pwsh`» — есть, его test зелёный. Оболочку test-ам задаёт harness: на
    Path оболочки он кладёт только системные папки (`windowsEnv`, `:62-81`).
  - «Граница 5 s мала» — два test-а ждали 10 s и упали так же.
  - «Медленный echo PSReadLine» — echo команды в тексте есть целиком; нет её вывода.
- **Следствие.** Ручной job не может проверить правки Terminal: Windows-свидетельство для PR #280 —
  только ПК исполнителя.

### 15 test-ов, которые падают на main (запуск 38364376194)

- `open starts Windows PowerShell with -NoLogo in the Project root with TERM_PROGRAM=worfy; input
  reaches it, output comes back`
- `terminal.close ends what runs in the shell: a program started in it, and one started with
  Start-Process` — ожидание 10 s на `:351`
- `resize changes the size of the pty, clamped to 20–500 columns and 5–300 rows`
- `a second open attaches to the running shell and replays its output`
- `the shell exiting on its own reports its exit code and stays exited until open asks for a restart`
- `two clients that opened one Terminal both get every chunk with the same end; the second open does
  not take the output from the first`
- `a client that attaches to a running shell gets the replay and its end; the chunks after it do not
  repeat the replay`
- `one of two clients destroyed: the shell lives on and the other gets its output; the last one
  destroyed: the shell is closed, not kept as exited`
- `Restart from A: B gets terminal.started with the new pid, and an open from B attaches to the new
  shell`
- ``the new shell gets `gh auth login` typed once it has started, and runs it; a shell opened
  without one gets nothing``
- `close ends a program two levels under the shell: the shell started cmd.exe, and cmd.exe the
  program` — ожидание 10 s на `:980`
- `close leaves no conhost.exe behind and starts no helper process; it is done well inside its bound`
- `a shell that exited on its own is asked nothing by its pid afterwards: no helper process is
  started`
- `will-quit waits for every shell, even one that ignores SIGHUP, then quits again`
- ``drops keys the contract does not declare: a `cwd` from the renderer does not move the shell``

## Что делаем

1. **Найти причину замером на runner-е.** Временный test-файл в ручном job-е: одна команда в
   `powershell.exe` через node-pty, весь вывод с отметками времени за 60 s. Что различить: приходит
   ли вывод позже 10 s; зависит ли исход от ширины pty (prompt runner-а — 74 столбца из 80);
   `$PSVersionTable` и загружен ли PSReadLine. Что показал замер — в «Итог».
2. **Потом одно из двух:**
   - test-ы идут на runner-е — правка harness-а test-ов по найденной причине;
   - либо test-ы на настоящей оболочке намеренно помечены «только ПК»: пропуск с причиной на
     runner-е и запись в шапке `windows-tests.yml`, что job не судит правки Terminal.
3. **После вливания PR #280** — то же для его файлов `test/contract/terminal-windows.test.ts` (случаи
   Windows) и `test/contract/terminal-harness.ts` (harness и `run`). На main этих файлов нет.

## Готово, когда

- [x] Причина названа по замеру на runner-е; вывод замера — в «Итоге».
- [ ] Ручной job на `test/contract/terminal.test.ts`: 0 упавших — либо 15 test-ов пропущены с
      причиной, и это записано в `windows-tests.yml` и в test-файле.
- [ ] На ПК владельца те же test-ы идут и зелёные: пропуск их там не выключает.
- [ ] `gate full` зелёный на Mac.

## Тесты

- Проверка — сам ручной job: числа «прошло / упало / пропущено» до и после, с номерами запусков.
- Если введён пропуск: test на условие пропуска — на ПК оно ложно, на runner-е истинно.

## Где в коде

- `test/contract/terminal.test.ts` — `windowsEnv` (`:62-81`), `spawnWithoutProfile` (`:84`), `harness`
  (`:156-250`), `run` (`:245-248`).
- `.github/workflows/windows-tests.yml`; `test/contract/windows-tests-workflow.test.ts`.

## Вне скоупа

- Что пишут в ввод оболочки ответы экрана — [Ticket 39](39-ответы-экрана-считаются-вводом.md).
- Падение с кодом 3221225477 — [Ticket 40](40-node-pty-падает-при-одновременном-kill.md).

## Риски

- **Пропуск на runner-е оставляет Terminal без проверки на чистой Windows.** Тогда это записанное
  решение, а не падение, к которому привыкли.
- **Причина может быть в образе runner-а:** записать в «Итог» версию образа.
- **Каждый замер — запуск Windows-runner-а:** один короткий test-файл на запуск, запусков немного.

## Итог

### Что готово на Windows-ПК (2026-10-18) и чего ждём

Замер шага 1 должен идти на runner-е, а запуск ручного job-а `windows-tests.yml` — решение владельца: ни Session на ПК, ни Session на Mac его запускать не могут. **Ждём:** один короткий запуск `windows-tests.yml` на ветке `worfy-windows/41-probe` (`6370f6c`) с `files=test/contract/terminal-probe-41.test.ts` (по желанию вместе с `test/contract/terminal.test.ts` — воспроизвести 15 падений рядом с замером). Ветку не менять.

- **Проба** `test/contract/terminal-probe-41.test.ts` (временная, на ветке `worfy-windows/41-probe`, PR нет):
  - запускает `powershell.exe` через сам harness Terminal-а (`test/contract/terminal-harness.ts`): то же окружение `windowsEnv`, `-NoLogo -NoProfile`, временная папка Project-а; ширина pty 80 и 200 столбцов; `pwsh` — контроль на тех же ширинах;
  - сразу после open печатает `Write-Output ('probe-' + (6*7))`, как `run`, затем строку с `$PSVersionTable.PSVersion`, `$Host.Name`, версией PSReadLine, кодировкой консоли и `$PSStyle`; если за 30 s вывода нет — всё равно печатает вторую строку (читается ли ввод позже);
  - каждый кусок вывода — строка `[probe41 …]` JSON с ms от open, до 60 s; итог по сценарию, версии оболочек без pty, переменные образа runner-а;
  - каждый случай проходит, когда запись собрана: job зелёный;
  - пишет через `process.stdout.write`: в job-е без TTY reporter vitest по умолчанию выбрасывает `console.log` прошедших test-ов (проверено под Node из Electron, как идёт job: 739 строк пробы в логе).
- **Проба на ПК** (Windows 11 Pro 10.0.26200, Node 24.21.0 из Electron 44.5.1, node-pty 1.1.0; exit 0):

| Оболочка, ширина | Echo команды | Вывод команды | Версия | PSReadLine |
|---|---|---|---|---|
| `powershell.exe`, 80 | 576 ms | 705 ms | 5.1.26100.9711 | 2.0.0 |
| `powershell.exe`, 200 | 922 ms | 1039 ms | 5.1.26100.9711 | 2.0.0 |
| `pwsh.exe`, 80 | 609 ms | 647 ms | 7.6.6 | 2.4.5 |
| `pwsh.exe`, 200 | 597 ms | 635 ms | 7.6.6 | 2.4.5 |

  Host — ConsoleHost, кодировка консоли — cp866 (культура ru-RU). Ни одна оболочка не вышла до закрытия.
- **15 test-ов из списка на ПК проходят.** После PR #280 они разделены: 10 в `test/contract/terminal.test.ts` (exit 0: 44 прошло, 3 пропущено — случай только macOS и два «не на Windows»), 5 в `test/contract/terminal-windows.test.ts` (exit 0: 13 прошло). Test с `gh auth login` настоящий `gh` не достаёт: на Path оболочки только временный home test-а со stub-ом `gh.cmd` и системные папки.
- **Вывод для причины:** на ПК Windows PowerShell 5.1 отвечает меньше чем за 1,1 s на обеих ширинах, так что разница — в среде runner-а (образ, версия PSReadLine, консоль), а не в harness-е вообще. Назвать её может только замер на runner-е.
- **Попутно для [Ticket-а 40](40-node-pty-падает-при-одновременном-kill.md):** четыре брошенные оболочки `powershell.exe -NoLogo -NoProfile` с headless-консолями 80×24 от прогонов test-ов Terminal-а 2026-10-17 — запись там.

### Замер на runner-е: запуск 39090844904 (2026-10-18)

Запуск разрешил владелец, запустила Session на Mac: [39090844904](https://github.com/IDSAD-XL/worfy/actions/runs/39090844904), `windows-tests.yml` на ветке `worfy-windows/41-probe` (`6370f6c`), `files=test/contract/terminal-probe-41.test.ts`, exit 0. Лог прочитала Session на Windows-ПК. Runner: Windows Server 10.0.26100, образ `win25-vs2026` 20261007.264.1, Node 24.21.0 из Electron 44.5.1, node-pty 1.1.0.

| Оболочка, ширина | Prompt | Echo команды | Вывод команды | Вторая команда, вывод | Версия, PSReadLine, кодировка |
|---|---|---|---|---|---|
| `powershell.exe`, 80 | 625 ms | 798 ms | **26 799 ms** | 27 074 ms | 5.1.26100.33438, 2.0.0, IBM437 |
| `powershell.exe`, 200 | 492 ms | 609 ms | **24 321 ms** | 24 489 ms | то же |
| `pwsh.exe`, 80 | 751 ms | 865 ms | 935 ms | 1 132 ms | 7.6.6, 2.4.5, ibm437 |
| `pwsh.exe`, 200 | 687 ms | 792 ms | 882 ms | 1 047 ms | то же |

(Время — от вызова open. На ПК тот же замер: вывод Windows PowerShell через 705 и 1039 ms.)

- **Вывод не теряется — он приходит через 24–27 s.** После echo команды и перевода строки (+817 ms) оболочка молчит: ни одного куска вывода до +26,8 s (на ширине 200 — до +24,3 s). Потом приходят `probe-42`, prompt, а вторая команда, напечатанная следом, отвечает за 170–280 ms. Медленная только **первая** команда свежего Windows PowerShell. Test-ы ждали 5 s (`run`) и 10 s — поэтому 15 падений «echo есть, вывода нет».
- **Ширина ни при чём:** 80 и 200 столбцов — одинаково (24–27 s). PSReadLine 2.0.0 — тот же, что на ПК; echo приходит сразу. `pwsh` 7.6.6 на том же runner-е отвечает меньше чем за 1 s.
- **Где уходят 25 s — по замеру без pty.** Вызов `powershell.exe -NoLogo -NoProfile -NonInteractive -Command …Get-Module -ListAvailable PSReadLine…` с тем же окружением `windowsEnv` на runner-е не уложился в 30 s (`Command failed`, timeout пробы); на ПК он идёт меньше секунды. Первая команда заставляет Windows PowerShell искать команды по всем модулям `PSModulePath`; кэш этого поиска (ModuleAnalysisCache) лежит в `%LOCALAPPDATA%\Microsoft\Windows\PowerShell`, а `windowsEnv` даёт каждой оболочке пустой временный `LOCALAPPDATA` (`test/contract/terminal-harness.ts:57`). На ПК модулей мало, на образе runner-а — много. Это объяснение по замеру и устройству PowerShell 5.1; отдельно на runner-е (например, с готовым кэшем или узким `PSModulePath`) оно не проверялось.
- **Шаг 2, вариант «test-ы идут на runner-е».** `windowsEnv` задаёт `PSModulePath` только с папкой модулей системы (`%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules`) — так же, как он уже задаёт `Path` только из системных папок: test-ам Terminal-а другие модули не нужны, а поиск по одной папке короткий. Проверка — ещё один запуск ручного job-а на `test/contract/terminal.test.ts` и `test/contract/terminal-windows.test.ts` (решение владельца). Вариант «только ПК» (пропуск на runner-е) остаётся запасным.
- **Не про test-ы, а про приложение:** worfy запускает Windows PowerShell с настоящим `LOCALAPPDATA` пользователя, кэш там уже есть — у пользователя первой команде ждать не нужно. На свежей системе с большим набором модулей первая команда может быть медленной и в приложении; не мерилось.
