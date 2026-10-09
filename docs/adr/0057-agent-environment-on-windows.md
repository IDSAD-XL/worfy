# 0057 — Окружение агента на Windows: как при новом входе — постоянные переменные из реестра и переменные сеанса, без ключей API; Git Bash через `CLAUDE_CODE_GIT_BASH_PATH`, `claude.exe`
Дата: 2026-10-09. Статус: принят.

**Контекст.** Окружение процесса Claude Code собирает `src/main/agent/env.ts` (ADR-0007). На macOS worfy
один раз запускает login shell пользователя (`$SHELL -ilc`) из минимального окружения и берёт его
окружение без `ANTHROPIC_API_KEY` и `ANTHROPIC_AUTH_TOKEN`. Минимальное окружение на входе нужно,
чтобы переменные того, кто запустил worfy, — например, родительской Session Claude Code, когда worfy
идёт как `pnpm dev` из её Bash tool, — не дошли до дочернего Claude Code. ADR-0054 (полный порт под
Windows) оставил выбор окружения на Windows Ticket-у 09 Epic-а `worfy-windows`.

Факты с Windows-ПК владельца (evidence Ticket-а 01 Epic-а `worfy-windows`, разделы 04, 13, 14, 16, 20,
27):

- `$SHELL` и `/bin/zsh` на Windows нет: `execFile` падает, worfy отдаёт запасное окружение с POSIX
  `PATH` и без `SystemRoot`, `USERPROFILE` и `Path`. Экран первого запуска с таким окружением пишет
  про `git`, `gh` и `node` «not found on the PATH of the login shell», хотя все три стоят.
- В окружении процесса, который запустила Session Claude Code, — `CLAUDECODE=1`, 22 переменные
  `CLAUDE_CODE_*`, `CLAUDE_AGENT_SDK_*`, `CLAUDE_PID` и `NoDefaultCurrentDirectoryInExePath=1`; там же
  может оказаться `GH_TOKEN` hook-а этой Session и любые переменные её терминала.
- Постоянные переменные Windows лежат в реестре: машины —
  `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment`, пользователя —
  `HKCU\Environment`; часть значений — `REG_EXPAND_SZ` со ссылками `%…%`. Переменные сеанса
  (`USERPROFILE`, `APPDATA`, `LOCALAPPDATA` …) Windows задаёт при входе вне этих ключей.
- Первый `bash` в `Path` — `C:\Windows\System32\bash.exe`, запуск WSL. Claude Code 2.1.233 без
  `CLAUDE_CODE_GIT_BASH_PATH` нашёл Git Bash сам, но как — не установлено.
- В пакете `@anthropic-ai/claude-agent-sdk-win32-x64` файл Claude Code — `claude.exe`.
- Имена переменных на Windows не различают регистр.

**Решение.**

1. **На Windows login shell не запускается; окружение собирается как при новом входе.**
   - Основа — переменные сеанса из процесса worfy, по списку `WINDOWS_SESSION_VARS`: `SystemRoot`,
     `SystemDrive`, `windir`, `ComSpec`, `PATHEXT`, `TEMP`, `TMP`, `USERPROFILE`, `HOMEDRIVE`,
     `HOMEPATH`, `HOMESHARE`, `APPDATA`, `LOCALAPPDATA`, `ProgramData`, `LOGONSERVER`,
     `USERDOMAIN_ROAMINGPROFILE`, `USERDNSDOMAIN`, `SESSIONNAME`, `CLIENTNAME`, `ProgramFiles`,
     `ProgramFiles(x86)`, `ProgramFiles(Arm)`, `ProgramW6432`, `CommonProgramFiles`,
     `CommonProgramFiles(x86)`, `CommonProgramFiles(Arm)`, `CommonProgramW6432`, `PUBLIC`,
     `ALLUSERSPROFILE`, `COMPUTERNAME`, `USERNAME`, `USERDOMAIN`, `OS`, `PROCESSOR_ARCHITECTURE`,
     `PROCESSOR_IDENTIFIER`, `PROCESSOR_LEVEL`, `PROCESSOR_REVISION`, `NUMBER_OF_PROCESSORS`. Больше из
     процесса не берётся ничего. Часть из них (`ComSpec`, `PATHEXT`, `TEMP`, `windir` …) обычно есть и
     в ключе машины: значение реестра главнее, копия из процесса остаётся, только если в реестре такого
     имени нет, и в запасном окружении.
   - Реестр читается Windows PowerShell по абсолютному пути
     (`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive
     -EncodedCommand`, скрыто, timeout 10 с; `SystemRoot` пустой или не абсолютный — `C:\Windows`).
     Ключ открывается через .NET (`[Microsoft.Win32.Registry]::CurrentUser` / `LocalMachine`
     `.OpenSubKey`), не через провайдер реестра: модуль не грузится (`PSModulePath` может прийти от
     родителя на pwsh 7), подключ передаётся в base64 — кавычки не нужны. `GetValue(имя, '',
     'DoNotExpandEnvironmentNames')`, только `REG_SZ` и `REG_EXPAND_SZ`, имя и значение — base64 от
     UTF-8, так что вывод — ASCII при любой кодовой странице консоли. Ошибка — строка `Error <base64>`
     и exit 1; в `error` worfy — она, либо «timed out after 10 s», либо последняя строка stderr. `reg query` не годится: в pipe он пишет в OEM-кодировке консоли (на ПК
     владельца — 866), и `C:\Users\Алексей\日本\😀` читался как UTF-8 в `C:\Users\����ᥩ\??\??`, без
     ошибки (проверено на ПК владельца временным ключом `HKCU\Software\worfy-probe`, ревью PR #194,
     четвёртый круг).
   - Сверху — постоянные переменные из реестра (оба ключа), как при входе в Windows:
     сначала ключ машины целиком, до финальных значений, потом ключ пользователя — его значение
     заменяет машинное. Внутри ключа: `REG_SZ` кладётся как есть и не раскрывается никогда.
     `REG_EXPAND_SZ` ждёт, пока все переменные, на которые он ссылается, станут финальными (не ждут
     сами в этом же ключе), и тогда каждая `%ИМЯ%` один раз заменяется их значением; подставленный
     текст повторно не сканируется. Повторяется, пока есть прогресс. Поэтому:
     - `%NVM_HOME%` в `Path` находит `NVM_HOME`, который идёт в том же ключе ниже (nvm-windows);
     - `%PATHEXT%` в пользовательском `PATHEXT=%PATHEXT%;.PY` — машинное значение, и выходит
       `.COM;.EXE;.BAT;.CMD;.PY`; так же `PSModulePath`;
     - ключ машины не видит переменную, заданную только у пользователя: ссылка на неё в машинном
       значении остаётся как есть;
     - неизвестная переменная и ссылки внутри цикла (`A=%B%`, `B=%A%`) остаются как есть;
     - значение, которое при раскрытии хоть в какой-то момент стало бы длиннее 32 767 символов
       (предел одной переменной в Windows), остаётся как есть; длина считается по ходу раскрытия;
     - значение обрезается по первому NUL, как его читают C-строковые API входа, а имя с NUL
       отбрасывается: `GetValue` NUL внутри значения сохраняет, а Node с таким окружением отказывает
       в `spawn` (`ERR_INVALID_ARG_VALUE`) — не стартовал бы ни один агент, и запасное окружение
       этого не ловит.

     `Path` — исключение: финальный `Path` машины, за ним финальный `Path` пользователя, под одним
     ключом; пустой не добавляет `;`. Нет `Path` ни в одном ключе (или оба пустые) — `Path` нет.
   - Убираются `ANTHROPIC_API_KEY` и `ANTHROPIC_AUTH_TOKEN` при любом регистре — как на macOS, даже
     если пользователь задал их сам.
   - Если реестр прочитать не удалось или разбор упал — ровно переменные сеанса и `Path` процесса,
     ничего из реестра (реестр собирается отдельно и берётся только целиком), `from: 'fallback'`,
     `error` говорит почему (как запасное окружение на macOS).

   Переменная, которую пользователь задал сам (`setx ANTHROPIC_MODEL …`), доходит до Claude Code — как
   на macOS экспорт из rc-файла. Переменные родительской Session и терминала, из которого запущен
   worfy (`CLAUDECODE`, `CLAUDE_CODE_*`, `GH_TOKEN`, `WORFY_*` …), — нет. `CapturedEnv.from` —
   `'registry'`.
2. **Git Bash для Claude Code.** worfy ищет Git Bash (`findGitBash`): от `git.exe` в `Path` — корень Git
   for Windows над `cmd`, `bin` или `mingw64\bin`, Git Bash — `<корень>\bin\bash.exe`; затем
   `%ProgramFiles%\Git` и `%LOCALAPPDATA%\Programs\Git`. Ничего под `%SystemRoot%` не берётся, в том
   числе `System32\bash.exe`. Найденный путь worfy задаёт в `CLAUDE_CODE_GIT_BASH_PATH`, если у
   пользователя в реестре нет своей. Не найден — переменной нет, `error`: «Git Bash not found: the
   agent has no Bash tool». `findOnPath` (видит и псевдоним MSIX — `pwsh.exe` из winget) и
   `findGitBash` экспортируются: их берут экран первого запуска и Terminal.
3. **`claude.exe`** (ADR-0008). В упакованной сборке на Windows путь —
   `<resources>\app.asar.unpacked\node_modules\@anthropic-ai\claude-agent-sdk-win32-<arch>\claude.exe`,
   с разделителями Windows. Путь собирается разделителями платформы сборки, а не машины, на которой
   идёт код, — test-ы обеих платформ идут где угодно.
4. **macOS и Linux не меняются:** login shell, `SYSTEM_PATH`, `SHELL_BASE_KEYS` — как в ADR-0007.

ADR-0007 принят и не правится: этот ADR — его ветка для Windows.

**Последствия.**

- Session-ы, `gh` для бейджей PR, Terminal и экран первого запуска на Windows получают окружение, в
  котором `git`, `gh` и `node` находятся (test `win32` в `test/unit/agent-env.test.ts`). Подписи
  экрана первого запуска («login shell», `brew install`) правит Ticket 13.
- Переменная, которую пользователь задал только в своём терминале (без `setx`), до Claude Code не
  доходит — как на macOS переменная, не записанная в rc-файл.
- Изменение переменных в реестре после запуска worfy видно со следующего запуска worfy: окружение
  собирается один раз.
- Без Git Bash Claude Code на Windows работает без Bash tool; экран первого запуска показывает это
  отдельно (Ticket 13).
- Первое окружение агента ждёт запуска Windows PowerShell (два параллельных, по одному на ключ): на
  ПК владельца около 0,4 с, под нагрузкой test-ов — до нескольких секунд. Один раз на запуск worfy.
- Если `powershell.exe` запрещён политикой (AppLocker и подобное) — запасное окружение с `error`. Не
  проверялось: на ПК владельца таких политик нет.
- В Constrained Language Mode (AppLocker/WDAC) вызовы .NET запрещены: чтение всегда падает, агент
  получает запасное окружение.
- При включённой политике PowerShell transcription base64 всех постоянных переменных, секреты
  тоже, попадает в файлы транскрипта.
- Средства защиты (EDR) могут помечать `powershell.exe -EncodedCommand`, запущенный настольным
  приложением. Передача скрипта через stdin (`-Command -`) — долг Ticket-а 09.
- Пользовательское значение со ссылкой на `%Path%` (например, `P2=%Path%`) получает только `Path`
  пользователя, а итоговый `Path` — машины и пользователя. Как здесь поступает сама Windows, не
  проверено; случай редкий, записан долгом в Ticket 09.

## Considered Options

- **Окружение процесса worfy минус переменные родительской Session** (`CLAUDE*`, `ANTHROPIC_*`,
  `NoDefaultCurrentDirectoryInExePath`, кроме записанных в реестре). Первый вариант Ticket-а 09.
  Отвергнут на ревью PR #194: всё прочее того, кто запустил worfy, — `GH_TOKEN`, `GITHUB_TOKEN`,
  `WORFY_*`, переменные терминала — доходило бы до Claude Code, Terminal и `gh` любого Project-а. На
  macOS этого нет: login shell стартует из минимального окружения.
- **Окружение процесса как есть.** То же, плюс переменные родительской Session.
- **Раскрывать `REG_EXPAND_SZ` сразу при чтении, в порядке выдачи `reg query`.** Второй вариант PR
  #194. Отвергнут на втором ревью: ссылка на переменную, которая идёт ниже в том же ключе, оставалась
  буквальной — у nvm-windows (`%NVM_HOME%` в `Path`, `NVM_HOME` ниже) агент не нашёл бы node.
- **Читать реестр через `reg query`.** Первые три варианта PR #194. Отвергнуто на четвёртом ревью:
  `reg.exe` пишет в pipe в OEM-кодировке консоли, не-ASCII данные приходят испорченными, а символы
  вне этой кодировки — уже `?`; ошибки нет, запасное окружение не включается. Перекодировать вывод из
  OEM мало — потеря происходит раньше.
- **Читать через `reg export` в файл.** Файл в UTF-16LE, `REG_EXPAND_SZ` — `hex(2):`, без потерь и
  без PowerShell. Не выбрано: нужен временный файл и разбор формата `.reg` (экранирование, `hex(2)`,
  переносы строк); вызов PowerShell с `GetValue` короче и проверен на ПК владельца.
- **Два прохода по сырым значениям обоих ключей сразу.** Третий вариант PR #194: сырые значения
  машины и пользователя в одном наборе (пользовательское заменяет машинное), потом два прохода
  раскрытия. Отвергнут на третьем ревью: пользовательский `PATHEXT=%PATHEXT%;.PY` раскрывался по
  собственному сырому тексту и давал `%PATHEXT%;.PY;.PY;.PY;.PY` — без `.COM`, `.EXE`, `.BAT`,
  `.CMD` `cmd` и `where.exe` не находят программы по имени; так же ломался `PSModulePath`. Второй
  проход к тому же раскрывал подставленный текст, в том числе `%…%` из значений `REG_SZ`.
- **Только реестр, без переменных сеанса.** Без `USERPROFILE`, `APPDATA`, `LOCALAPPDATA` и других
  переменных, которые Windows задаёт при входе, не раскрываются ссылки `%…%` и не работают программы,
  которые их читают.
- **Положиться на поиск Git Bash самим Claude Code.** Он сработал на ПК владельца, но как он ищет — не
  установлено; при WSL первым в `Path` явная переменная надёжнее.
- **Выбрано:** переменные сеанса по списку, реестр машины и пользователя с раскрытием, без ключей API;
  Git Bash — явной переменной.
