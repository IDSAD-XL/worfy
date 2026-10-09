# 0057 — Окружение агента на Windows: окружение процесса без ключей API и переменных родительской Session, Git Bash через `CLAUDE_CODE_GIT_BASH_PATH`, `claude.exe`
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
  `CLAUDE_CODE_*`, `CLAUDE_AGENT_SDK_*`, `CLAUDE_PID` и `NoDefaultCurrentDirectoryInExePath=1`.
  Последней нет в реестре пользователя и машины; с ней cmd.exe не ищет `.bat` в текущей папке.
- Первый `bash` в `Path` — `C:\Windows\System32\bash.exe`, запуск WSL. Claude Code 2.1.233 без
  `CLAUDE_CODE_GIT_BASH_PATH` нашёл Git Bash сам, но как — не установлено.
- В пакете `@anthropic-ai/claude-agent-sdk-win32-x64` файл Claude Code — `claude.exe`.
- Имена переменных на Windows не различают регистр; в копии окружения ключ пути — `Path`.

**Решение.**

1. **На Windows login shell не запускается.** Основа окружения агента — окружение процесса worfy: в нём
   уже `Path` пользователя и машины. Из него убираются:
   - `ANTHROPIC_API_KEY` и `ANTHROPIC_AUTH_TOKEN` при любом регистре имени — как на macOS;
   - переменные родительской Session: имена с началом `CLAUDE` или `ANTHROPIC_` и
     `NoDefaultCurrentDirectoryInExePath` — если их нет в постоянном окружении Windows
     (`HKCU\Environment` и `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment`,
     `reg query`). Так переменная, которую пользователь задал сам (`setx ANTHROPIC_MODEL …`), доходит
     до Claude Code — как на macOS экспорт из rc-файла;
   - если `reg query` не ответил — все такие переменные, а `error` результата говорит почему.

   Ключ пути остаётся один, значение не меняется. `CapturedEnv.from` — `'process'`.
2. **Git Bash для Claude Code.** worfy ищет Git Bash (`findGitBash`): от `git.exe` в `Path` — корень Git
   for Windows над `cmd`, `bin` или `mingw64\bin`, Git Bash — `<корень>\bin\bash.exe`; затем
   `%ProgramFiles%\Git` и `%LOCALAPPDATA%\Programs\Git`. Папка Windows (`%SystemRoot%`) и
   `System32\bash.exe` не берутся никогда. Найденный путь worfy задаёт в `CLAUDE_CODE_GIT_BASH_PATH`,
   если у пользователя нет своей. Не найден — переменной нет, `error`: «Git Bash not found: the
   agent has no Bash tool». `findOnPath` и `findGitBash` экспортируются: их берут экран первого
   запуска и Terminal.
3. **`claude.exe`** (ADR-0008). В упакованной сборке на Windows путь —
   `<resources>\app.asar.unpacked\node_modules\@anthropic-ai\claude-agent-sdk-win32-<arch>\claude.exe`,
   с разделителями Windows. Путь собирается разделителями платформы сборки, а не машины, на которой
   идёт код, — test-ы обеих платформ идут где угодно.
4. **macOS и Linux не меняются:** login shell, `SYSTEM_PATH`, `SHELL_BASE_KEYS` — как в ADR-0007.

ADR-0007 принят и не правится: этот ADR — его ветка для Windows.

**Отвергнуто.**

- **Окружение процесса как есть.** Переменные родительской Session (`CLAUDECODE`, `CLAUDE_CODE_*`,
  `NoDefaultCurrentDirectoryInExePath`) ушли бы в дочерний Claude Code — то, от чего ADR-0007 защищает
  минимальным окружением на входе shell.
- **Минимальное окружение, как на macOS.** На Windows нет shell, который бы его дополнил: `Path`,
  `SystemRoot` и прочее пришлось бы собирать заново из реестра, с раскрытием `%…%`.
- **Убирать все `CLAUDE*` и `ANTHROPIC_*` без реестра.** Пропали бы переменные, которые пользователь
  задал сам, — на macOS они доходят до Claude Code через rc-файл.
- **Положиться на поиск Git Bash самим Claude Code.** Он сработал на ПК владельца, но как он ищет — не
  установлено; при WSL первым в `Path` явная переменная надёжнее.

**Последствия.**

- Session-ы, `gh` для бейджей PR, Terminal и экран первого запуска на Windows получают окружение, в
  котором `git`, `gh` и `node` находятся (test `win32` в `test/unit/agent-env.test.ts`). Подписи
  экрана первого запуска («login shell», `brew install`) правит Ticket 13.
- Переменная родительской Session, которую пользователь записал в постоянное окружение сам, доходит
  до Claude Code: это его выбор, как на macOS.
- Без Git Bash Claude Code на Windows работает без Bash tool; экран первого запуска показывает это
  отдельно (Ticket 13).
