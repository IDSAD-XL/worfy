# 88 — link-access: первый `echo` PowerShell-а дольше ожидания на Windows runner-е

Type: task
Status: done 2026-10-22T06:05Z
PR: #735
Blocked by: —
Source: Windows runner (`windows-tests.yml`) на main до PR #729 (`12414df9`, run 39719315567) и после него
(run 39719318138), 2026-10-22. Строки — по main `206b8aea`.

## Что происходит

В `test/contract/link-access.test.ts` test-ы печатают строку в Terminal Machine B — настоящий Windows
PowerShell, который запускает `TerminalRegistry` (`src/main/terminal/pty.ts`), — и ждут её вывод
(`SHELL_WAIT_MS`, 30 с). На GitHub Windows runner-е эти ожидания красные:

- до PR #729 — 2 из 25: `:528` «access on > handlers that read event.sender…» и `:556` «switching access off >
  in the middle of a subscription»;
- после PR #729 (временный профиль у shell-а B: `windowsProfileEnv(home)` в `shellEnv()`) — 3 из 26: те же два
  и `:685` «read-only access > lowered from all to read-only…».

В тексте assertion-а PSReadLine рисует набранную строку по символу, с перемещениями курсора и цветами
(`\e[1;75H\e[93me…`, потом `ec…`), а ожидаемого вывода (`link-42`, `before-2`, `before-7`) нет. На ПК
владельца файл зелёный (48 passed).

## Что делаем

1. Найти, почему вывода нет: PSReadLine (перерисовка), профиль после PR #729 или что-то ещё.
2. Воспроизвести поведение runner-а на ПК, если получится.
3. Правка в test-е по причине, без skip; файл зелёный 3 раза подряд.

## Готово, когда

- [x] Причина найдена и записана в «Итог».
- [x] Три test-а выше зелёные на Windows runner-е (`windows-tests.yml` с этим файлом), без skip.
- [x] На ПК и на Mac файл зелёный; `pnpm lint`, `pnpm typecheck` — exit 0.

## Где в коде

- `test/contract/link-access.test.ts:155` (`windowsRoot`, `shellEnv`), `:388` (`PROMPT`), `:523`, `:554`, `:565`,
  `:683`, `:697` (набранные строки).
- `src/main/terminal/pty.ts:213` (Windows PowerShell: `pwsh` нет в `SYSTEM_PATH` test-а).

## Итог

Причина — дефект test-а: первая команда свежего Windows PowerShell-а ищет модуль дольше 30 с.
PSReadLine и перерисовка не виноваты.

- `echo` в PowerShell — псевдоним `Write-Output` из модуля `Microsoft.PowerShell.Utility`. При старте
  shell-а этот модуль не загружен (проверено: `Get-Module` пуст), и первый `echo` загружает его
  автоматически. Для этого PowerShell обходит модули в порядке `PSModulePath` и анализирует каждый,
  пока не найдёт команду. `Microsoft.PowerShell.Utility` лежит в последней папке
  (`System32\WindowsPowerShell\v1.0\Modules`), а перед ней — `C:\Program Files\WindowsPowerShell\Modules`,
  куда образ runner-а ставит Az, Microsoft.Graph, AWSPowerShell, SqlServer и другие модули для всех
  пользователей.
- Кэш анализа модулей пустой. Образ runner-а держит готовый кэш в `PSModuleAnalysisCachePath`
  (по комментарию в `Configure-PowerShell.ps1` образа, первый запуск PowerShell-а так быстрее примерно
  на 20 с), но `shellEnv()` собирает окружение shell-а с нуля, без этой переменной. Кэш по умолчанию —
  в `LOCALAPPDATA`; после PR #729 это временный профиль test-а, до него — профиль `runneradmin`, где кэша
  тоже нет. Поэтому красные test-ы были и до PR #729; третий, скорее всего, на границе 30 с.
- Перерисовка по символу — обычный вывод PSReadLine 2.0.0 через ConPTY, на ПК он такой же
  (`\e[1;75H\e[93me…` — приглашение длиной 74 символа). Набранная строка доходит до `\r\n`, дальше shell
  молчит: команда ещё ищет модуль.
- Воспроизведено на ПК. Сначала длина приглашения как у runner-а: `TEMP` длиной 39 символов (как
  `C:\Users\runneradmin\AppData\Local\Temp`) — вывод начинается с того же `\e[1;75H\e[93me`, файл зелёный.
  Потом 400 модулей по 3000 функций во временной папке `Documents\WindowsPowerShell\Modules` профиля
  shell-а (тоже раньше `System32` в пути, правка test-а только на время прогона, не в коммите):
  красные ровно три test-а runner-а — `:528`, `:556`, `:685` (в прогоне `:538`, `:566`, `:695`, сдвиг на
  10 строк правки), каждый около 32 с, текст assertion-а тот же: строка набрана, `\r\n`, вывода нет.
  Замер отдельным `powershell -NoProfile` с 60 такими модулями: `echo hi` — 9,4 с, `"hi"` — 0,3 с,
  `Microsoft.PowerShell.Utility\Write-Output hi` — 0,4 с.
- Ограничить `PSModulePath` нельзя: Windows PowerShell 5.1 сам вставляет
  `C:\Program Files\WindowsPowerShell\Modules` перед `System32`, даже когда переменная задана (проверено
  на ПК), — модули runner-а остались бы в пути. Отключить PSReadLine причину тоже не убирает: замер
  выше — `powershell -NonInteractive`, без PSReadLine.
- Правка: на Windows test печатает строку выражением в кавычках (`"link-$((40+2))"`) — PowerShell
  выводит строку сам, без поиска команды; на macOS и Linux `/bin/sh` по-прежнему получает
  `echo link-$((40+2))` (помощник `printLine`). Набранный ввод по-прежнему не содержит ожидаемого
  вывода. С правкой и теми же 400 модулями файл зелёный (26 passed), без них — зелёный 3 раза подряд.
- История PSReadLine владельца (`ConsoleHost_history.txt`) не менялась: размер 190084 и SHA256
  `856228…148E` до и после каждого прогона.
- Не проверено: прогон на самом runner-е (нужен `windows-tests.yml` с этим файлом) и на Mac.

### Мерж (2026-10-22)

PR #735 влит 2026-10-22, merge commit `b9a64940`.

- Windows runner (`windows-tests.yml` с `test/contract/link-access.test.ts`), run 39722365848: link-access — 26 из
  26, без skip. Три test-а из «Что происходит» (`:528`, `:556`, `:685` по main `206b8aea`) зелёные.
- Mac, дерево merge PR с main: `pnpm lint`, `pnpm typecheck` и `test/contract/link-access.test.ts` прошли. Gate full
  не запускался: PR меняет один test-файл. На ПК файл зелёный 3 раза подряд (см. «Итог»).
- Причина: первый `echo` в свежем Windows PowerShell ждёт, пока PowerShell проанализирует каждый модуль из
  `PSModulePath`. На `win32` test теперь печатает строку в кавычках, без `echo`.
