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
     `HOMEPATH`, `APPDATA`, `LOCALAPPDATA`, `ProgramData`, `ProgramFiles*`, `CommonProgramFiles*`,
     `PUBLIC`, `ALLUSERSPROFILE`, `COMPUTERNAME`, `USERNAME`, `USERDOMAIN`, `OS`, `PROCESSOR_*`,
     `NUMBER_OF_PROCESSORS`. Больше из процесса не берётся ничего.
   - Сверху — постоянные переменные из реестра (`reg query` обоих ключей): сначала машины, потом
     пользователя — пользователя главнее. Значения `REG_SZ` и `REG_EXPAND_SZ`; ссылки `%…%`
     раскрываются по уже собранным переменным, неизвестная остаётся как есть. `Path` — `Path` машины,
     за ним `Path` пользователя, под одним ключом.
   - Убираются `ANTHROPIC_API_KEY` и `ANTHROPIC_AUTH_TOKEN` при любом регистре — как на macOS, даже
     если пользователь задал их сам.
   - Если `reg query` не ответил — окружение из переменных сеанса и `Path` процесса,
     `from: 'fallback'`, `error` говорит почему (как запасное окружение на macOS).

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

## Considered Options

- **Окружение процесса worfy минус переменные родительской Session** (`CLAUDE*`, `ANTHROPIC_*`,
  `NoDefaultCurrentDirectoryInExePath`, кроме записанных в реестре). Первый вариант Ticket-а 09.
  Отвергнут на ревью PR #194: всё прочее того, кто запустил worfy, — `GH_TOKEN`, `GITHUB_TOKEN`,
  `WORFY_*`, переменные терминала — доходило бы до Claude Code, Terminal и `gh` любого Project-а. На
  macOS этого нет: login shell стартует из минимального окружения.
- **Окружение процесса как есть.** То же, плюс переменные родительской Session.
- **Только реестр, без переменных сеанса.** Без `USERPROFILE`, `APPDATA`, `LOCALAPPDATA` и других
  переменных, которые Windows задаёт при входе, не раскрываются ссылки `%…%` и не работают программы,
  которые их читают.
- **Положиться на поиск Git Bash самим Claude Code.** Он сработал на ПК владельца, но как он ищет — не
  установлено; при WSL первым в `Path` явная переменная надёжнее.
- **Выбрано:** переменные сеанса по списку, реестр машины и пользователя с раскрытием, без ключей API;
  Git Bash — явной переменной.
