# Evidence Ticket-а 01 — факты порта на живой Windows

Снято 2026-10-09 на Windows-ПК владельца Session-ей Claude Code (desktop app, вкладка Code). Клон —
`C:\Users\Alexey\worfy`, main на `76f7ff8` (`worfy-link/14: keep the Project machine awake …`). После
мержа PR #150 (`3837558`) ветка перебазирована на main `08e8256`; там же сняты заново `pnpm test`
(раздел 17, из JSON-отчёта vitest), опись Harness (раздел 18), `realpath.native` (раздел 06) и
сверка файлов сборки (раздел 24). `package.json` и `pnpm-lock.yaml` между этими коммитами не менялись.
Временные файлы и полные логи — `%TEMP%\worfy-01\` на ПК, в репозиторий не идут; здесь — хвосты
вывода и exit code. Раздел `### NN` с номером 01–15 — факт `3.NN` тикета: на эти номера ссылаются
Ticket-ы 02–17 («evidence Ticket-а 01, раздел N»). Разделы 16 и дальше — состояние машины, пробный
запуск, опись Harness, порядок ведения Epic-а и находки, которых в тикете не было.

Отступления от тикета (решения владельца на 2026-10-09):

- Шаг 4 (опись Harness) сделан на текущем main `08e8256`, а не после закрытия E3: E3 открыт
  (Ticket-ы 23–26). Пункт «Готово, когда» про опись после закрытия E3 не отмечен.
- Harness на ПК не ставился, `%USERPROFILE%\.claude` не правился. Hooks проверены в песочнице:
  тестовый plugin в `%TEMP%\worfy-01\hook-plugin`, `claude -p --plugin-dir … --no-session-persistence`.
- На ПК уже стояли Git, node (через nvm-windows), pnpm, gh, VS Build Tools и Python. Владелец решил:
  Git 2.45.1 не обновлять; node — `nvm use 22.13.0` (сделал сам); pwsh — поставить через winget;
  факт 08 — проверить косвенно (Build Tools не удалять).
- Ошибки `pnpm` не чинились. Чтобы увидеть исход `lint`, `typecheck`, `test` и `dev` после упавшего
  `pnpm install`, их запуск шёл с флагами одного запуска (`--config.verify-deps-before-run=false`,
  для `test` ещё `--config.shell-emulator=true`); репозиторий и конфиг pnpm не менялись.

### 01. Windows: редакция, build, архитектура

```
PS> cmd /c ver
Microsoft Windows [Version 10.0.26200.9550]
EXIT=0
PS> $env:PROCESSOR_ARCHITECTURE
AMD64
PS> (Get-CimInstance Win32_OperatingSystem).Caption
Майкрософт Windows 11 Pro
HKLM\…\CurrentVersion: EditionID Professional, DisplayVersion 25H2, CurrentBuild 26200, UBR 9550
```

Вывод: Windows 11 Pro 25H2, build 26200, x64 — подходит под Q24, ConPTY есть (build ≥ 18309).

### 02. Smart App Control

```
PS> Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy | Select VerifiedAndReputablePolicyState
VerifiedAndReputablePolicyState : 0
```

Вывод: по реестру Smart App Control выключен (0 — off, 1 — on, 2 — evaluation). Окно Windows
Security → App & browser control вручную не открывалось; сверка там — вопрос владельцу в отчёте PR.
Вопрос подписи по Q22 сейчас не встаёт.

### 03. Git for Windows: core.autocrlf и core.longpaths

Git стоял до этой Session (не свежая установка), обновлять его владелец не стал.

```
PS> git --version
git version 2.45.1.windows.1
PS> git config --show-origin --show-scope --get-all core.autocrlf
system  file:C:/Program Files/Git/etc/gitconfig  true
global  file:C:/Users/Alexey/.gitconfig          true
EXIT=0
PS> git config --show-origin --show-scope --get-all core.longpaths
system  file:C:/Program Files/Git/etc/gitconfig  true
EXIT=0
PS> git config --get core.symlinks
false
```

После `gh repo clone` в клоне без `.gitattributes`:

```
$ git ls-files --eol | awk '{print $1, $2}' | sort | uniq -c
    191 i/-text w/-text
   1088 i/lf w/crlf
      3 i/none w/none
$ file harness/bin/epic-status
harness/bin/epic-status: Bourne-Again shell script, … with CRLF line terminators
```

После rebase на main `08e8256` (ветка этого Ticket-а; файл evidence не считается, один Ticket этого
Epic-а записан с LF):

```
$ git ls-files --eol | grep -v 'scratch/worfy-windows/evidence/' | awk '{print $1, $2}' | sort | uniq -c
    207 i/-text w/-text
   1104 i/lf w/crlf
      1 i/lf w/lf
      3 i/none w/none
```

Вывод: `core.autocrlf=true` (в system — установщик, в global — сам владелец), `core.longpaths=true`.
Все текстовые файлы индекса в рабочем дереве — с CRLF (1088 на `76f7ff8`), `git status` при этом
пуст.

### 04. Какие bash и sh первыми в PATH PowerShell

```
PS> where.exe bash
C:\Windows\System32\bash.exe
C:\Users\Alexey\AppData\Local\Microsoft\WindowsApps\bash.exe
EXIT=0
PS> where.exe sh
INFO: Could not find files for the given pattern(s).
EXIT=1
PS> wsl.exe -l -v
* Ubuntu          Stopped   2
  docker-desktop  Stopped   2
PS> C:\Windows\System32\bash.exe -c "echo hi"
EXIT=1   (WSL: «не удалось запустить WSL2 — на компьютере не включена виртуализация»)
```

Постоянный PATH: в Machine только `C:\Program Files\Git\cmd` (и `GitHub CLI`), в User папок Git
нет. У PowerShell, который запускает Claude Code, к ним добавлен `C:\Program Files\Git\mingw64\bin`,
но не `usr\bin`.

Вывод: `bash` из PATH — WSL (и он здесь даже не запускается), `sh` в PATH нет. Git Bash в PATH
PowerShell не виден.

### 05. Что есть в Git Bash; BSD-флаги stat и date

Команды шли в Bash tool этой Session (Git Bash). Вывод — как снят, кроме трёх сокращений, помеченных
«…»: в `uname -a` пропущено имя машины; в PATH пропущена середина (папки программ Windows), начало и
конец — как есть; в выводе `stat -f %m` пропущены строки сведений о файловой системе после
`File: "package.json"`.

```
$ uname -a
MINGW64_NT-10.0-26200 … 3.4.10-87d57229.x86_64 2024-02-14 x86_64 Msys
$ echo "BASH=$BASH $BASH_VERSION"; echo "PATH=$PATH"
BASH=/usr/bin/bash 5.2.26(1)-release
PATH=/c/Users/Alexey/bin:/mingw64/bin:/usr/local/bin:/usr/bin:/bin:/mingw64/bin:/usr/bin:/c/Users/Alexey/bin:… (папки Windows) …:/mingw64/bin:/c/Program Files/GitHub CLI:/c/WINDOWS/system32:/c/WINDOWS:/c/WINDOWS/System32/Wbem:/c/WINDOWS/System32/WindowsPowerShell/v1.0:/c/WINDOWS/System32/OpenSSH:/c/Users/Alexey/AppData/Local/Programs/cursor/resources/app/bin:/usr/bin/vendor_perl:/usr/bin/core_perl
$ for c in jq perl shasum sha1sum sha256sum realpath zsh; do p=$(command -v $c); echo "$c -> ${p:-<none>} (rc=$?)"; done
jq -> <none> (rc=1)
perl -> /usr/bin/perl (rc=0)
shasum -> /usr/bin/core_perl/shasum (rc=0)
sha1sum -> /usr/bin/sha1sum (rc=0)
sha256sum -> /usr/bin/sha256sum (rc=0)
realpath -> /usr/bin/realpath (rc=0)
zsh -> <none> (rc=1)
$ stat -f %m package.json; echo "stat-f EXIT=$?"
stat: cannot read file system information for '%m': No such file or directory
  File: "package.json" … (сведения о файловой системе)
stat-f EXIT=1
$ stat -c %Y package.json
1791509715
$ date -v-14d; echo "date-v EXIT=$?"
date: unknown option -- v
Try 'date --help' for more information.
date-v EXIT=1
$ date -d '-14 days' +%F
2026-09-25
$ command -v cygpath; cygpath -m /tmp
/usr/bin/cygpath
C:/Users/Alexey/AppData/Local/Temp
$ echo "TMPDIR=[$TMPDIR]"        (Bash tool Session Claude Code)
TMPDIR=[/c/Users/Alexey/AppData/Local/Temp]
```

Вывод: в Git Bash 2.45.1 есть perl, shasum, sha1sum, realpath, cygpath; нет jq и zsh. BSD
`stat -f %m` и `date -v-14d` кончаются exit 1; GNU-формы работают. `TMPDIR` в Bash tool задан.
`shasum` лежит в `/usr/bin/core_perl`: в PATH Bash tool эта папка есть (в конце). В PATH
node-процесса hook-а, который записал `probe.mjs` (раздел 13), её нет:

```
PS> node %TEMP%\worfy-01\hookpath.cjs %TEMP%\worfy-01\hook-plugin\probe-out\node-form-50240.json
hook PATH entries: 68
core_perl in hook PATH: false
vendor_perl in hook PATH: false
Git entries:
  C:\Program Files\Git\mingw64\bin
  C:\Program Files\Git\usr\bin
  C:\Program Files\Git\bin
  C:\Program Files\Git\cmd
  C:\Program Files\Git\mingw64\bin
EXIT=0
```

PATH bash-hook-а, запущенного по shebang, проба не записала: найдёт ли `stop.sh` `shasum` в
команде hook-а, не установлено.

### 06. Пути у git и Git Bash

```
PS> git rev-parse --show-toplevel        → C:/Users/Alexey/worfy
PS> git rev-parse --git-common-dir       → .git
PS> (Get-Location).Path                  → C:\Users\Alexey\worfy
$ git rev-parse --show-toplevel          → C:/Users/Alexey/worfy
$ git rev-parse --git-common-dir         → .git
$ pwd                                    → /c/Users/Alexey/worfy
$ pwd -W                                 → C:/Users/Alexey/worfy
```

В worktree (`.claude\worktrees\windows-long-path-probe-0123456789abcdefg`), из Git Bash:

```
git rev-parse --show-toplevel → C:/Users/Alexey/worfy/.claude/worktrees/windows-long-path-probe-0123456789abcdefg
git rev-parse --git-common-dir → C:/Users/Alexey/worfy/.git
git rev-parse --git-dir        → C:/Users/Alexey/worfy/.git/worktrees/windows-long-path-probe-0123456789abcdefg
cat .git                       → gitdir: C:/Users/Alexey/worfy/.git/worktrees/windows-long-path-probe-0123456789abcdefg
```

`realpath.native` (Git Bash, node 22.13.0) — в клоне и во временном worktree
`git worktree add --detach C:/Users/Alexey/worfy/.claude/worktrees/realpath-probe origin/main`
(после снят `git worktree remove --force`):

```
$ node -p "require('fs').realpathSync.native('.')"        (клон)
C:\Users\Alexey\worfy
EXIT=0
$ cd …/.claude/worktrees/realpath-probe && node -p "require('fs').realpathSync.native('.')" && git rev-parse --show-toplevel
C:\Users\Alexey\worfy\.claude\worktrees\realpath-probe
C:/Users/Alexey/worfy/.claude/worktrees/realpath-probe
```

Вывод: git и в PowerShell, и в Git Bash печатает `C:/…` — буква диска заглавная, разделитель `/`.
`realpath.native` даёт `C:\…`: написания расходятся только разделителем. `pwd` Git Bash — `/c/…`.

### 07. Домашняя папка

```
PowerShell:  HOME=<пусто>  USERPROFILE=C:\Users\Alexey  node os.homedir() → C:\Users\Alexey
Git Bash:    HOME=/c/Users/Alexey  USERPROFILE=C:\Users\Alexey  node os.homedir() → C:\Users\Alexey  echo ~ → /c/Users/Alexey
hook (bash, по shebang):  HOME=/c/Users/Alexey  USERPROFILE=C:\Users\Alexey  node os.homedir() → C:\Users\Alexey
hook (node):  process.env.HOME=C:\Users\Alexey  USERPROFILE=C:\Users\Alexey  os.homedir() → C:\Users\Alexey
```

Вывод: в PowerShell `HOME` нет; в Git Bash и в hook-ах он есть (в bash — `/c/…`, в node-процессе
hook-а — `C:\…`). `os.homedir()` везде — `C:\Users\Alexey`.

### 08. pnpm install --frozen-lockfile без Visual Studio Build Tools

В чистом виде не установлено: на ПК стоят VS Build Tools 2017 и 2022, Python 2.7 и 3.12 (`winget
list`), удалять их владелец не стал. Проверено косвенно — дважды.

1) Из Session Claude Code (как будет у агентов Epic-а):

```
PS> pnpm install --frozen-lockfile
.../esbuild@0.25.12/node_modules/esbuild postinstall$ node install.js
.../esbuild@0.28.2/node_modules/esbuild postinstall$ node install.js
.../node-pty@1.1.0/node_modules/node-pty install$ node scripts/prebuild.js || node-gyp rebuild
.../node-pty@1.1.0/node_modules/node-pty install: > Checking prebuilds...
.../node-pty@1.1.0/node_modules/node-pty install: Done
.../node-pty@1.1.0/node_modules/node-pty postinstall$ node scripts/post-install.js
.../node-pty@1.1.0/node_modules/node-pty postinstall: Done
.../esbuild@0.28.2/node_modules/esbuild postinstall: Done
.../esbuild@0.25.12/node_modules/esbuild postinstall: Done
. postinstall$ electron-rebuild --only node-pty
. postinstall: Building modules: node-pty
. postinstall: 'GetCommitHash.bat' is not recognized as an internal or external command,
. postinstall: gyp: Call to 'cmd /c "cd shared && GetCommitHash.bat"' returned exit status 1 while in deps\winpty\src\winpty.gyp.
. postinstall: ✖ Rebuild Failed
[ELIFECYCLE] Command failed with exit code 4294967295.
EXIT=-1   (54 s)
```

Причина: процесс Claude Code задаёт `NoDefaultCurrentDirectoryInExePath=1` (в User и Machine
переменной нет). Тогда cmd.exe не ищет `GetCommitHash.bat` в текущей папке — файл в пакете есть
(`deps/winpty/src/shared/GetCommitHash.bat`).

2) Тот же запуск без этой переменной (как в обычном терминале владельца):

```
. postinstall: …\MSBuild\Microsoft\VC\v170\Microsoft.CppBuild.targets(511,5): error MSB8040: для этого
  проекта требуются библиотеки с устранением рисков Spectre … [conpty.vcxproj] (и ещё 3 проекта)
. postinstall: ✖ Rebuild Failed
[ELIFECYCLE] Command failed with exit code 4294967295.
EXIT=-1
```

Вывод: root `postinstall` (`electron-rebuild --only node-pty`) на этом ПК падает всегда: из Session
— на `GetCommitHash.bat`, вне Session — на Spectre-библиотеках MSVC. Пересборка из исходников
требовала бы Build Tools с компонентом Spectre-mitigated libs. Зависимости при этом разложены, node-pty
свой `install` прошёл (готовая сборка), падает только root `postinstall`. Так же падает и в worktree
(раздел 11).

### 09. node-pty в Electron без пересборки

`build` у node-pty — только `config.gypi`, `build/Release` нет. `pnpm exec` здесь не годится: pnpm 11
перед запуском снова зовёт `pnpm install` и падает на том же `postinstall` (`runDepsStatusCheck`,
exit 1). Electron запущен напрямую через `cli.js` (бинарник Electron 44 качается при первом запуске).

```
PS> $env:ELECTRON_RUN_AS_NODE="1"; node node_modules\electron\cli.js -e "const p=require('node-pty'); console.log('node-pty ok', typeof p.spawn, 'electron', process.versions.electron, 'node', process.versions.node, 'modules', process.versions.modules)"
Downloading Electron binary...
node-pty ok function electron 44.5.1 node 24.21.0 modules 149
EXIT=0
PS> (то же) spawn('cmd.exe', ['/c','echo pty-alive']) через ConPTY
out-has-marker true exitCode 0
EXIT=0
```

Через node-pty из `prebuilds/win32-x64` запускаются и оболочки Ticket-а 10. Скрипт
`%TEMP%\worfy-01\pty-pwsh.cjs` шёл в Electron, как и проба выше:
`$env:ELECTRON_RUN_AS_NODE="1"; node node_modules\electron\cli.js pty-pwsh.cjs <оболочка> <аргументы>`.

```
C:\Users\Alexey\AppData\Local\Microsoft\WindowsApps\pwsh.exe -NoLogo -NoProfile -Command '$x=2+3; Write-Output worfy-$x' → has worfy-5: true exitCode 0
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe (то же)                           → has worfy-5: true exitCode 0
C:\Program Files\Git\bin\bash.exe --login -c 'echo "worfy-$((2+3))"'                        → has worfy-5: true exitCode 0
```

С аргументом `Write-Output ("worfy-" + (2+3))` оба PowerShell дали exit 1 без вывода: node-pty
склеивает аргументы в командную строку, и двойные кавычки внутри аргумента ломаются.

Вывод: готовая сборка `prebuilds/win32-x64` грузится в Electron 44.5.1 без пересборки, ConPTY
работает; пересборка node-pty на Windows не нужна.

### 10. Оболочка скриптов pnpm

```
PS> pnpm config get script-shell     → undefined   EXIT=0
PS> pnpm config get shell-emulator   → undefined   EXIT=0
PS> npm config get script-shell      → null
PS> pnpm --config.verify-deps-before-run=false test
$ ELECTRON_RUN_AS_NODE=1 electron ./node_modules/vitest/vitest.mjs run
'ELECTRON_RUN_AS_NODE' is not recognized as an internal or external command,
operable program or batch file.
[ELIFECYCLE] Test failed. See above for more details.
EXIT=1   (1 s)
PS> pnpm --config.verify-deps-before-run=false --config.shell-emulator=true test
… vitest стартует и доходит до итога (раздел 17)
```

Вывод: pnpm исполняет скрипты через cmd.exe; префикс `VAR=value` в `test` там не работает. С
`shell-emulator=true` тот же скрипт запускает vitest.

### 11. Длина пути

```
PS> Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem | Select LongPathsEnabled
LongPathsEnabled : 1
$ git worktree add .claude/worktrees/windows-long-path-probe-0123456789abcdefg -b probe/… origin/main
EXIT=0   (имя — 41 символ)
PS> pnpm install --frozen-lockfile   (в worktree)
. postinstall: 'GetCommitHash.bat' is not recognized … ✖ Rebuild Failed
EXIT=-1   (48 s)
самые длинные пути в node_modules worktree:
278 C:\Users\Alexey\worfy\.claude\worktrees\windows-long-path-probe-0123456789abcdefg\node_modules\.pnpm\@typescript-eslint+eslint-p_8c8f4521c47f0ef4afb0473cd148cdad\node_modules\@typescript-eslint\eslint-plugin\dist\rules\prefer-optional-chain-utils\PreferOptionalChainOptions.d.ts
276 …\PreferOptionalChainOptions.js
273 …\@typescript-eslint+type-uti_c197f388242d3b1f661a52068a183297\…\typeDeclaredInPackageDeclarationFile.d.ts
```

Вывод: `LongPathsEnabled=1`, `core.longpaths=true`. pnpm разложил в worktree пути до 278 символов
(больше MAX_PATH 260) без ошибок о длине; `pnpm install` в worktree падает только на `postinstall`
(раздел 08). На ПК без `LongPathsEnabled` это не проверено.

### 12. Имя папки транскриптов

С согласия владельца — три `claude -p` в `C:\a\b`, `%TEMP%\worfy-01\with space` и
`%TEMP%\worfy-01\кириллица`. Запросы упали на входе (`OAuth session expired`), но папки в
`%USERPROFILE%\.claude\projects` и транскрипты с `cwd` Claude Code создал. Сверка —
`%TEMP%\worfy-01\f312.cjs` (правило `projectDirName`, `src/main/claude-home/registry.ts:42-47`,
`MAX_DIR_NAME = 200`).

```
"C:\\a\\b" -> C--a-b | on disk: true
"C:\\Users\\Alexey\\AppData\\Local\\Temp\\worfy-01\\with space" -> C--Users-Alexey-AppData-Local-Temp-worfy-01-with-space | on disk: true
"C:\\Users\\Alexey\\AppData\\Local\\Temp\\worfy-01\\кириллица" -> C--Users-Alexey-AppData-Local-Temp-worfy-01---------- | on disk: true
C--a-b … .jsonl cwd = "C:\\a\\b"
C--Users-…-with-space … .jsonl cwd = "C:\\Users\\Alexey\\AppData\\Local\\Temp\\worfy-01\\with space"
C--Users-…-worfy-01---------- … .jsonl cwd = "C:\\Users\\Alexey\\AppData\\Local\\Temp\\worfy-01\\кириллица"
EXIT=0
```

Вывод: Claude Code 2.1.233 на Windows кодирует путь тем же правилом, что `projectDirName`: `C:\a\b`
→ `C--a-b`. Кириллица — по `-` на букву (9 дефисов), как и на Mac. `cwd` в транскрипте — с `\`.

### 13. Hooks

Песочница: plugin `%TEMP%\worfy-01\hook-plugin` (`hooks/probe.sh` — bash по shebang,
`hooks/probe.mjs` — node по shebang и через `node "${CLAUDE_PLUGIN_ROOT}/…"`), запуск
`claude -p … --plugin-dir %TEMP%\worfy-01\hook-plugin --no-session-persistence --model haiku` в
`%TEMP%\worfy-01\hook-cwd`. `hooks.json` песочницы:

```
SessionStart: "${CLAUDE_PLUGIN_ROOT}/hooks/probe.sh" shebang-sh
SessionStart: "${CLAUDE_PLUGIN_ROOT}/hooks/probe.mjs" shebang-mjs
SessionStart: node "${CLAUDE_PLUGIN_ROOT}/hooks/probe.mjs" node-form   (пишет export WORFY_PROBE_VAR=from-session-start в CLAUDE_ENV_FILE)
PreToolUse (Bash|Write): node "${CLAUDE_PLUGIN_ROOT}/hooks/probe.mjs" pretooluse
```

Сработали все: `probe-out/` — `shebang-sh-*.txt`, `shebang-mjs-*.json`, `node-form-*.json`, два
`pretooluse-*.json`. Выдержки:

```
shebang-sh:  0=C:/Users/Alexey/AppData/Local/Temp/worfy-01/hook-plugin/hooks/probe.sh
             BASH=/usr/bin/bash 5.2.26(1)-release  MSYSTEM=MINGW64
             PWD=/tmp/worfy-01/hook-cwd   pwd -W=C:/Users/Alexey/AppData/Local/Temp/worfy-01/hook-cwd
             CLAUDE_PLUGIN_ROOT=C:/Users/Alexey/AppData/Local/Temp/worfy-01/hook-plugin
             CLAUDE_PROJECT_DIR=C:/Users/Alexey/AppData/Local/Temp/worfy-01/hook-cwd
             CLAUDE_ENV_FILE=C:\Users\Alexey\.claude\session-env\<id>\sessionstart-hook-0.sh
             node=/c/Program Files/nodejs/node jq= zsh=
node-form:   argv[0]=C:\Program Files\nodejs\node.exe  cwd=C:\Users\Alexey\AppData\Local\Temp\worfy-01\hook-cwd
             SHELL=C:\Program Files\Git\bin\bash.exe   NoDefaultCurrentDirectoryInExePath=1
             PATH начинается с C:\Program Files\Git\mingw64\bin;C:\Program Files\Git\usr\bin;…
stdin SessionStart: {"transcript_path":"C:\\Users\\Alexey\\.claude\\projects\\C--Users-Alexey-AppData-Local-Temp-worfy-01-hook-cwd\\<id>.jsonl",
                     "cwd":"C:\\Users\\Alexey\\AppData\\Local\\Temp\\worfy-01\\hook-cwd","hook_event_name":"SessionStart","source":"startup"}
PreToolUse Write: {"file_path":"C:\\Users\\Alexey\\AppData\\Local\\Temp\\worfy-01\\hook-cwd\\probe-written.txt","content":"x"}
PreToolUse Bash:  {"command":"echo PROBE=$WORFY_PROBE_VAR", …}   env WORFY_PROBE_VAR у hook-а: null
ответ модели на Bash tool: PROBE=from-session-start
claude EXIT=0
```

Вывод:
- (а) hook, который зовёт скрипт по shebang, срабатывает: команда hook-а идёт в Git Bash
  (`/usr/bin/bash`, MINGW64), и `.sh`, и `.mjs` с `#!/usr/bin/env node` запускаются;
- (б) форма `node "${CLAUDE_PLUGIN_ROOT}/…"` срабатывает, node находится (`C:\Program Files\nodejs\node.exe`);
- (в) `${CLAUDE_PLUGIN_ROOT}` в команде и в окружении и `CLAUDE_PROJECT_DIR` — `C:/…` (с `/`);
  `cwd`, `transcript_path`, `tool_input.file_path` и `CLAUDE_ENV_FILE` — `C:\…` (с `\`);
- (г) переменная, записанная `SessionStart` в `CLAUDE_ENV_FILE`, доходит до Bash tool; в окружение
  других hook-ов она не попадает.

Попутно: Claude Code нашёл Git Bash без `CLAUDE_CODE_GIT_BASH_PATH` (переменная не задана), хотя
первым `bash` в PATH стоит WSL; `SHELL` у hook-а — `C:\Program Files\Git\bin\bash.exe`.

### 14. claude.exe из Agent SDK

```
$ ls -d node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-win32-x64*
node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-win32-x64@0.3.289
$ ls …/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64
LICENSE.md  README.md  claude.exe  package.json
$ …/claude-agent-sdk-win32-x64/claude.exe --version
2.1.289 (Claude Code)
EXIT=0
```

Вывод: pnpm на Windows ставит `@anthropic-ai/claude-agent-sdk-win32-x64@0.3.289` сам; файл —
`claude.exe`, запускается.

### 15. qmd

Версия — как в E3 Ticket 17 (`QMD_VERSION`): `@tobilu/qmd@2.8.3`, во временный `npm_config_prefix`
`%TEMP%\worfy-01\qmd-prefix`.

```
PS> npm install -g @tobilu/qmd@2.8.3
added 158 packages in 1m
EXIT=0
PS> qmd.cmd --version
qmd 2.8.3 (facd35e)
EXIT=0
PS> qmd.cmd status
EXIT=-1073741819   (0xC0000005, access violation; вывода нет)
PS> (XDG_CACHE_HOME, XDG_CONFIG_HOME, HOME — во %TEMP%\worfy-01) qmd.cmd status / collection add C:\Users\Alexey\worfy\docs\adr --name adr / search "Windows port" -n 3
status EXIT=-1073741819
add EXIT=-1073741819
search EXIT=-1073741819
PS> Get-ChildItem -Recurse $env:XDG_CACHE_HOME, $env:HOME | Select -First 5 -Expand FullName
C:\Users\Alexey\AppData\Local\Temp\worfy-01\qmd-cache\qmd
PS> Test-Path C:\Users\Alexey\.cache\qmd; (Get-Item C:\Users\Alexey\.cache\qmd).CreationTime
True
09.10.2026 4:45:51   (первый qmd status без XDG_*; папка пустая)
```

Нативные модули пакета: `better-sqlite3/prebuilds/win32-x64.node`, `tree-sitter-*`
`prebuilds/win32-x64`, `@reflink/reflink-win32-x64-msvc`. Какой из них падает, не установлено.
Первый `qmd status` создал пустую `C:\Users\Alexey\.cache\qmd` (до перенаправления кеша).

Вывод: qmd 2.8.3 на Windows ставится и печатает версию, но любая команда с индексом падает с
access violation. Сейчас qmd на Windows не работает — по Q21 Epic идёт на grep (путь Б Ticket-а 15).

### 16. Состояние машины до установки и версии инструментов

До установки (`winget list`, `where.exe git node pnpm gh pwsh`):

```
Git 2.45.1 (winget Git.Git; доступна 2.55.0.5)     C:\Program Files\Git\cmd\git.exe
GitHub CLI 2.89.0 (winget GitHub.cli)              C:\Program Files\GitHub CLI\gh.exe — уже вошли: IDSAD-XL (keyring), scopes gist, read:org, repo
node 20.19.5 через nvm-windows 1.1.11              C:\Program Files\nodejs — symlink на %APPDATA%\nvm\v20.19.5; в nvm ещё 22.13.0, 20.8.0, 18.18.2, 18.17.1, 14.21.3, 12.22.12
pnpm 10.30.0                                       C:\Program Files\nodejs\pnpm.cmd; ещё %LOCALAPPDATA%\pnpm\pnpm.exe (PNPM_HOME)
pwsh                                               INFO: Could not find "pwsh".
Visual Studio Build Tools 2017 и 2022, Python 2.7.15 и 3.12.2, Visual Studio Code
claude 2.1.233 (Claude Code)                       C:\Users\Alexey\.local\bin\claude.exe; desktop app Claude 2.26454.2
git config --global user.name / user.email         заданы
```

Установлено в этой Session:

```
PS> winget install --id Microsoft.PowerShell -e
Найдено PowerShell [Microsoft.PowerShell] Версия 7.6.6.0 … Успешно установлено
EXIT=0   (MSIX: C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.6.0_x64__8wekyb3d8bbwe, в PATH — псевдоним %LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe; UAC не спрашивал)
владелец: nvm use 22.13.0
PS> npm install -g pnpm@11.22.0
EXIT=0
```

Версии после установки:

```
git 2.45.1.windows.1 · node v22.13.0 (npm 10.9.2) · pnpm 11.22.0 · gh 2.89.0 · pwsh 7.6.6 ·
claude 2.1.233 (CLI), 2.1.289 (claude.exe из SDK) · Electron 44.5.1 (node 24.21.0, modules 149) ·
Windows 11 Pro 25H2, build 26200.9550, x64
```

### 17. Пробный запуск: pnpm install, dev, lint, typecheck, test

```
pnpm install --frozen-lockfile                       EXIT=-1 — root postinstall (раздел 08)
pnpm lint, pnpm exec electron … (как есть)          EXIT=1 — pnpm 11 перед скриптом снова зовёт install
  (без флага запускались только эти две; typecheck, test и dev — сразу с флагом):
  [ERROR] Command failed with exit code 4294967295: "…\node.exe" "…\pnpm.mjs" install … at runDepsStatusCheck
pnpm --config.verify-deps-before-run=false lint      EXIT=0 (19 s)
  $ eslint . && node scripts/check-handoff.mjs
  handoff: ok (70 строк, 14741 байт)
pnpm --config.verify-deps-before-run=false typecheck EXIT=0 (31 s)
pnpm --config.verify-deps-before-run=false test      EXIT=1 (1 s) — 'ELECTRON_RUN_AS_NODE' is not recognized (раздел 10)
pnpm … --config.shell-emulator=true test             main 76f7ff8: EXIT=1 (305 s)
   Test Files  55 failed | 97 passed (152)
        Tests  660 failed | 2221 passed | 40 skipped (2921)
pnpm … --config.shell-emulator=true test --reporter=default --reporter=json --outputFile.json=%TEMP%\worfy-01\vitest-08e8256.json
                                                     main 08e8256: EXIT=1 (224 s)
   Test Files  55 failed | 102 passed (157)
        Tests  662 failed | 2292 passed | 41 skipped (2995)
pnpm --config.verify-deps-before-run=false dev       окно открылось
```

`pnpm dev`: хвост лога — `electron main process built successfully`, `dev server running for the
electron renderer process at http://localhost:5173/`, `starting electron app...`. Владелец: «открылось
привычное окно, всё в порядке, передо мной First run». Снимка нет; процесс остановлен этой Session.

Упавшие файлы `pnpm test` на main `08e8256` — из JSON-отчёта vitest (`assertionResults` со `status: "failed"` по файлу; третий столбец — самая частая первая строка ошибки в файле, как есть; четвёртый — разбор, у каждого назван источник). Таблица собрана скриптом `%TEMP%\worfy-01\jsonsum.cjs`; прежняя таблица по логу `76f7ff8` считала часть test-ов дважды (сумма 740 при сводке 660) и заменена этой.

| Файл | Упало | Первая строка ошибки (JSON) | Разбор (источник) |
|---|---|---|---|
| test/contract/actions.test.ts | 4 | `AssertionError: expected { ok: false, …(1) } to strictly equal { ok: true, value: { …(3) } }` |  |
| test/contract/agent-attachments.test.ts | 26 | `Error: agent.start: invalid input` | JSON: в тексте ошибки `✖ cwd must be an absolute path` — 26 из 26 |
| test/contract/agent-controls.test.ts | 37 | `Error: agent.start: invalid input` | JSON: `✖ cwd must be an absolute path` — 37 из 37 |
| test/contract/agent-session.test.ts | 20 | `Error: agent.start: invalid input` | JSON: `✖ cwd must be an absolute path` — 19 из 20 |
| test/contract/autopilot-journal.test.ts | 1 | `AssertionError: expected false to be true // Object.is equality` |  |
| test/contract/autopilot.test.ts | 9 | `AssertionError: expected { ok: false, …(1) } to deeply equal { ok: true, value: { …(13) } }` |  |
| test/contract/bindings.test.ts | 7 | `AssertionError: expected { ok: false, …(1) } to deeply equal { ok: true, value: { …(2) } }` |  |
| test/contract/canvas-tools.test.ts | 6 | `AssertionError: expected null to be 'demo-0a1b2c3d' // Object.is equality` |  |
| test/contract/card-bridge.test.ts | 1 | `AssertionError: expected null to be 'session-b' // Object.is equality` |  |
| test/contract/card-last-editor.test.ts | 4 | `AssertionError: expected null to be 'c1' // Object.is equality` |  |
| test/contract/card-protocol.test.ts | 7 | `AssertionError: expected false to be true // Object.is equality` |  |
| test/contract/claude-home-registry.test.ts | 39 | `AssertionError: expected false to be true // Object.is equality` |  |
| test/contract/claude-home-subagents.test.ts | 29 | `Error: call failed: claudeHome.subagents: call rejected, it came from an untrusted frame (file:///Applicati…` |  |
| test/contract/clients.test.ts | 10 | `AssertionError: expected false to be true // Object.is equality` |  |
| test/contract/docs.test.ts | 19 | `Error: docs.open: call rejected, it came from an untrusted frame (file:///Applications/worfy.app/Contents/R…` |  |
| test/contract/first-run-checks.test.ts | 28 | `Error: EPERM: operation not permitted, symlink '<клон>\test\fixtures\first-run-tools\claude' -> '%TEMP%\…` |  |
| test/contract/github-prs.test.ts | 26 | `AssertionError: expected false to be true // Object.is equality` |  |
| test/contract/harness-drift.test.ts | 9 | `Error: spawnSync /bin/sh ENOENT` |  |
| test/contract/harness-evals.test.ts | 41 | `AssertionError:   5   C 4 0 ; > A L   7 0 ? C A B 8 B L   W S L 2 ,   B 0 :   : 0 :   = 0   M B > <   : > <…` | по причинам (JSON, названия test-ов и `test/contract/harness-evals.test.ts`): 16 — CRLF во front matter: `frontMatter` ищет `^---\n` (`:32`), а `prompt.md` и грейдеры в рабочем дереве с CRLF — `[main]`/`[gui]` и `tool_used` у 8 кейсов; 8 — `builds its fixture`: `scaffold` зовёт `spawnSync('bash', …)` (`:63`) — это WSL, сообщение WSL2 в UTF-16 (раздел 04); 9 — проверки готовой фикстуры (`bin/profile -C <fixture>` exit 1, `epic-status` null): фикстуру строит тот же scaffold, связь отдельно не проверялась; 8 — группа `pnpm eval:harness` со stub `claude`: у 4 `spawnSync …\claude ENOENT`, у 4 — коды выхода и версия того же прогона |
| test/contract/harness-install.test.ts | 11 | `AssertionError: expected { outcome: 'done', status: { …(4) } } to deeply equal { outcome: 'done', status: {…` | лог `76f7ff8`, diff ожидания: `kind: "error"`, `step: "marketplace add"`, `Claude Code not found at …\stub\claude (ENOENT)` |
| test/contract/harness-migrate.test.ts | 54 | `SyntaxError: Bad escaped character in JSON at position 1877 (line 91 column 28)` |  |
| test/contract/harness-plugin.test.ts | 1 | `AssertionError: expected [ …(115) ] to deeply equal ArrayContaining{…}` |  |
| test/contract/harness-qmd.test.ts | 11 | `AssertionError: expected [] to deeply equal [ Array(1) ]` |  |
| test/contract/harness-scripts.test.ts | 22 | `AssertionError: bash is not installed: expected null to be +0 // Object.is equality` | названия test-ов в JSON: 5 проверок `<cmd> is on PATH` (`bash`, `zsh`, `jq`, `git`, `node`) и 17 прогонов `<файл> exits 0 with an empty HOME` |
| test/contract/ipc.test.ts | 7 | `AssertionError: expected { ok: false, …(1) } to deeply equal { ok: true, value: { echoed: 'hi' } }` |  |
| test/contract/layout-store.test.ts | 37 | `Error: layout.apply failed: layout.apply: call rejected, it came from an untrusted frame (file:///Applicati…` |  |
| test/contract/limits.test.ts | 3 | `AssertionError: expected { ok: false, …(1) } to deeply equal { ok: true, …(1) }` |  |
| test/contract/link-access.test.ts | файл | `EPERM: operation not permitted, symlink '%TEMP%\…' -> '%TEMP%\…` |  |
| test/contract/link-server.test.ts | 1 | `AssertionError: expected 1006 to be 1009 // Object.is equality` |  |
| test/contract/main-ipc-wiring.test.ts | 5 | `AssertionError: expected { ok: false, …(1) } to deeply equal { ok: true, …(1) }` |  |
| test/contract/make-icons.test.ts | 1 | `AssertionError: expected { …(2) } to deeply equal { …(2) }` | лог `76f7ff8`, diff ожидания: другие sha256 у `icon.svg` и `mark.svg` (в рабочем дереве SVG с CRLF) |
| test/contract/node-pty.test.ts | 1 | `Error: File not found:` | название test-а в JSON: `spawns /bin/echo in a pseudo-terminal…` |
| test/contract/permissions.test.ts | 15 | `Error: agent.start: invalid input` | JSON: `✖ cwd must be an absolute path` — 15 из 15 |
| test/contract/projects.test.ts | 26 | `Error: projects.add failed: projects.add: call rejected, it came from an untrusted frame (file:///Applicati…` |  |
| test/contract/shell.test.ts | 9 | `Error: EPERM: operation not permitted, symlink '%TEMP%\…' -> 'C:\Users\Alexey\AppData\Local\Temp` |  |
| test/contract/startup-failure.test.ts | 8 | `AssertionError: expected 'Step: checkDataFolder (checking the d…' to contain 'worfy\'s data folder: /tmp/wo…` |  |
| test/contract/statusline-bridge.test.ts | 8 | `AssertionError: expected { status: null, …(2) } to match object { status: +0 }` |  |
| test/contract/terminal.test.ts | 20 | `Error: terminal.open failed: File not found:` |  |
| test/contract/trash.test.ts | 14 | `Error: trash.put failed: trash.put: call rejected, it came from an untrusted frame (file:///Applications/wo…` |  |
| test/contract/viewport-store.test.ts | 8 | `AssertionError: expected { ok: false, …(1) } to deeply equal { ok: false, error: StringMatching{…} }` |  |
| test/contract/web-policy.test.ts | 2 | `AssertionError: expected false to be true // Object.is equality` |  |
| test/contract/workflow-profile.test.ts | 20 | `AssertionError: expected 'there is no profile script at \h\bin\…' to match /no profile script at \/h\/bin\/…` |  |
| test/contract/workflow-reader.test.ts | 25 | `AssertionError: expected { code: 'not-found', …(1) } to be null` |  |
| test/unit/agent-executable.test.ts | 2 | `AssertionError: expected '\Applications\worfy.app\Contents\Reso…' to be '/Applications/worfy.app/Contents/R…` |  |
| test/unit/agent-options.test.ts | 1 | `AssertionError: expected { plugin_worfy_qmd: { …(2) } } to deeply equal { plugin_worfy_qmd: { …(2) } }` |  |
| test/unit/attachments.test.ts | 5 | `AssertionError: expected false to be true // Object.is equality` |  |
| test/unit/build-version.test.ts | 2 | `Error: EPERM, Permission denied: \\?\%TEMP%\… '\\?\%TEMP%\…` |  |
| test/unit/canvas.test.tsx | файл | `EPERM: operation not permitted, symlink '<клон>\.claude' -> '%TEMP%\…'` |  |
| test/unit/epic-layout.test.ts | 1 | `Error: Test timed out in 5000ms.` |  |
| test/unit/gate-state.test.ts | 12 | `Error: spawnSync /bin/sh ENOENT` |  |
| test/unit/json-file.test.ts | 1 | `AssertionError: expected [Function] to throw an error` |  |
| test/unit/link-caller.test.ts | файл | `EPERM: operation not permitted, symlink '%TEMP%\…' -> '%TEMP%\…` |  |
| test/unit/paths.test.ts | 6 | `AssertionError: expected 'C:\tmp\worfy-data' to be '/tmp/worfy-data' // Object.is equality` |  |
| test/unit/session-rail-discovery.test.tsx | файл | `EPERM: operation not permitted, symlink '<клон>\.claude' -> '%TEMP%\…'` |  |
| test/unit/shell-discovery.test.tsx | файл | `EPERM: operation not permitted, symlink '<клон>\.claude' -> '%TEMP%\…'` |  |

Сумма по столбцу «Упало» — 662, как в сводке vitest.

«файл» — файл упал целиком при загрузке. Общие причины: пути с `\` и схемы «absolute POSIX path»;
`/bin/sh`, `/bin/zsh`, stub-ы `#!/bin/sh`; symlink без режима разработчика (раздел 22); `bash` из
PATH — WSL; проверка доверенного frame с путём macOS `file:///Applications/worfy.app/…`.

### 18. Опись скриптов Harness (на main 08e8256, до закрытия E3)

Опись снята дважды: на `76f7ff8` и, после мержа PR #150 (E3 Ticket 22, `3837558`), на `08e8256`.
Команда — первая строка каждого файла `harness/bin` и `harness/hooks` вне `tests` (Git Bash):

```
$ for f in $(git ls-files harness/bin harness/hooks | grep -v '/tests/'); do printf '%s\t%s\n' "$f" "$(head -n1 "$f" | tr -d '\r')"; done
harness/bin/TICKETS.md            # Glossary of tickets and epics
harness/bin/epic-board            #!/usr/bin/env node
harness/bin/epic-status           #!/usr/bin/env bash
harness/bin/preflight             #!/usr/bin/env bash
harness/bin/profile               #!/usr/bin/env node
harness/bin/qmd-collections       #!/usr/bin/env node
harness/bin/qmd-mcp               #!/bin/zsh
harness/bin/qmd-refresh           #!/bin/zsh
harness/bin/qmd-sync-main         #!/bin/zsh
harness/bin/silent-check          #!/usr/bin/env node        (новый на 08e8256)
harness/bin/ticket                #!/usr/bin/env node
harness/bin/worktree-lock         #!/usr/bin/env node
harness/hooks/gate-resolve.mjs    #!/usr/bin/env node
harness/hooks/gate.sh             #!/usr/bin/env bash
harness/hooks/gh-token-env.sh     #!/usr/bin/env bash
harness/hooks/guard.mjs           #!/usr/bin/env node
harness/hooks/hooks.json          {
harness/hooks/inject-rules.sh     #!/usr/bin/env bash
harness/hooks/rules/common.md     # worfy Harness — common rules
harness/hooks/rules/orchestrator.md  # worfy Harness — orchestrator rules
harness/hooks/session-end.sh      #!/usr/bin/env bash
harness/hooks/session-start.sh    #!/usr/bin/env bash
harness/hooks/stop.sh             #!/usr/bin/env bash
harness/hooks/worktree-create.sh  #!/usr/bin/env bash         (новый на 08e8256)
EXIT=0
$ diff <опись 76f7ff8> <опись 08e8256>
9a10
> harness/bin/silent-check	#!/usr/bin/env node
22a24
> harness/hooks/worktree-create.sh	#!/usr/bin/env bash
$ grep -c 'worktree-create' harness/hooks/hooks.json
0
$ git show --stat=200 --format= 3837558 | grep -E 'harness/' | awk '{print $1}'   (PR #150, E3 Ticket 22; без файла Ticket-а E3)
harness/agents/implementer.md
harness/bin/epic-board
harness/bin/epic-status
harness/bin/preflight
harness/bin/profile
harness/bin/silent-check
harness/bin/tests/epic-wave-ship-ticket.test.sh
harness/bin/tests/harness-home.test.sh
harness/bin/tests/preflight.test.sh
harness/bin/tests/profile.test.sh
harness/bin/tests/real-home.sh
harness/bin/tests/silent-mode.test.sh
harness/bin/tests/skill-blocks.test.sh
harness/bin/tests/tickets-root.test.sh
harness/bin/ticket
harness/hooks/guard.mjs
harness/hooks/session-start.sh
harness/hooks/tests/guard-silent.test.sh
harness/hooks/tests/rules-hooks.test.sh
harness/hooks/tests/session-hooks.test.sh
harness/hooks/worktree-create.sh
harness/profiles/README.md
harness/skills/continuous-audit/SKILL.md
harness/skills/epic-wave/SKILL.md
harness/skills/retro/SKILL.md
harness/skills/ship-ticket/SKILL.md
$ grep -rnE 'stat -f|date -v|open -|ps -o|screencapture|osascript' harness/agents harness/hooks/rules
EXIT=1
$ grep -rnE 'stat -f|date -v' harness/skills
harness/skills/continuous-audit/SKILL.md:133:  | awk -v t="$(date -v-14d +%s)" '$2>t{print $1}' \
harness/skills/epic-wave/SKILL.md:383:  m=$(stat -f %m "$L" 2>/dev/null) || continue        # lock released between mkdi…
$ grep -n '^## ' harness/skills/epic-wave/SKILL.md            → 1. Preflight :74 · 4. Merge by policy :337
$ grep -n 'Lock on the main branch\|gh pr list --state open\|mergeStateStatus' harness/skills/epic-wave/SKILL.md
→ :79 gh pr list --state open --json number,headRefName,mergeStateStatus,files · :355 gh pr view <N> --json mergeStateStatus · :375 **Lock on the main branch.**
$ grep -n 'live-tickets' harness/skills/continuous-audit/SKILL.md   → :135
$ grep -n 'screencapture\|Screen Recording\|env -i\|ps -o comm\|^## 6' harness/skills/ship-ticket/SKILL.md
→ :192 ## 6. Checks · :219 … :224 `screencapture` · :231 `env -i` · :233 `open -b` · :234 `ps -o comm= -p <pid>`
$ for f in harness/hooks/*.sh harness/bin/epic-status harness/bin/preflight; do echo "$f jq=$(grep -c '\bjq\b' $f) profile=$(grep -c 'bin/profile\|PROFILE_BIN' $f) shasum=$(grep -c shasum $f)"; done
harness/hooks/gate.sh jq=0 profile=0 shasum=4
harness/hooks/gh-token-env.sh jq=1 profile=6 shasum=0
harness/hooks/inject-rules.sh jq=5 profile=0 shasum=0
harness/hooks/session-end.sh jq=3 profile=5 shasum=0
harness/hooks/session-start.sh jq=4 profile=5 shasum=0
harness/hooks/stop.sh jq=0 profile=0 shasum=2
harness/hooks/worktree-create.sh jq=2 profile=5 shasum=0
harness/bin/epic-status jq=0 profile=2 shasum=0
harness/bin/preflight jq=5 profile=3 shasum=0
```

Скрипты на bash и zsh — кто зовёт, исход в Git Bash без правок (CRLF в рабочем дереве, Harness не
установлен, реестра Gate нет), Ticket:

| Скрипт | Язык | Кто зовёт | В Git Bash как есть | Ticket |
|---|---|---|---|---|
| `harness/hooks/gate.sh` | bash | hooks.json (`TaskCompleted`, `TeammateIdle`), skills, agents | `bash harness/hooks/gate.sh --help` → EXIT=3: `[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: резолвер gate-resolve.mjs завершился с кодом 4` (реестра нет); `jq` не зовёт, `shasum` — да | 03 |
| `harness/hooks/inject-rules.sh` | bash | hooks.json (`SessionStart`, `SubagentStart`) | не запускался; зовёт `jq` — в Git Bash его нет (раздел 05) | 04 |
| `harness/hooks/session-start.sh` | bash | hooks.json (`SessionStart`) | не запускался; зовёт `jq` и `profile` | 04 |
| `harness/hooks/session-end.sh` | bash | hooks.json (`SessionEnd`) | не запускался; зовёт `jq` и `profile` | 04 |
| `harness/hooks/stop.sh` | bash | hooks.json (`Stop`) | не запускался; `jq` и `profile` не зовёт, `shasum` — да (в PATH node-процесса hook-а `core_perl` нет; для bash-hook-а не установлено, раздел 05) | 04 |
| `harness/hooks/gh-token-env.sh` | bash | hooks.json (`SessionStart`, E3 Ticket 18) | не запускался; зовёт `jq` и `profile` | 04 |
| `harness/hooks/worktree-create.sh` | bash | никто: в `hooks.json` не зарегистрирован (E3 Ticket 22) | не запускался; зовёт `jq` и `profile` | не портируется до решения E3 Ticket-а 24 (упомянут в 04) |
| `harness/bin/epic-status` | bash | skills, worfy (`reader.ts`), `preflight` | `bash harness/bin/epic-status --json` → EXIT=0, 56705 байт JSON; по shebang `./harness/bin/epic-status --json` → EXIT=0 | 05 |
| `harness/bin/preflight` | bash | skills `epic-wave`, `ship-ticket` | `--help` → EXIT=0; `--epic worfy-windows --no-fetch` → EXIT=2: `profile unreadable … gate-resolve.mjs failed (exit 4) — project not determined` | 06 |
| `harness/bin/qmd-mcp` | zsh | `harness/.mcp.json` (по shebang) | zsh нет — не запускается | 15 |
| `harness/bin/qmd-refresh` | zsh | hooks.json (`Stop`) | zsh нет | 15 |
| `harness/bin/qmd-sync-main` | zsh | строка `update:` коллекций `qmd-collections` | zsh нет | 15 |

Скрипты на Node (`profile`, `ticket`, `worktree-lock`, `epic-board`, `silent-check`,
`qmd-collections`, `gate-resolve.mjs`, `guard.mjs`) — у Ticket-ов 03, 04, 05 и 15 по их срезам. В
Git Bash: `node harness/bin/profile --help` → EXIT=0, `./harness/bin/profile --help` по shebang →
EXIT=0, `node harness/bin/ticket root` → EXIT=0 (`C:\Users\Alexey\worfy\.scratch`), `node
harness/bin/epic-board --help` → EXIT=2: `tickets root not determined: spawnSync
C:\Users\Alexey\worfy\harness\bin\ticket ENOENT` — node на Windows не запускает соседа по shebang.
`silent-check` (новый, Ticket 05) — те же места: соседей `profile` и `ticket` зовёт по пути
(`execFileSync(PROFILE, …)` `:84`, `execFileSync(TICKET, …)` `:112`), домашнюю папку берёт из
`process.env.HOME` (`:139`):

```
$ node harness/bin/silent-check hello
silent-check: profile not read (exit ENOENT): spawnSync C:\Users\Alexey\worfy\harness\bin\profile ENOENT
silent-check EXIT=2
$ grep -rln 'silent-check' harness src test | sort
harness/agents/implementer.md
harness/bin/silent-check
harness/bin/tests/silent-mode.test.sh
harness/bin/tests/skill-blocks.test.sh
harness/hooks/guard.mjs
harness/hooks/session-start.sh
harness/profiles/README.md
harness/skills/ship-ticket/SKILL.md
```

Скрипт E3, которого на main ещё нет: `harness/bin/project-connect` (node, по плану) — E3 Ticket 24,
открыт, PR нет. Опись после закрытия E3 — отдельным коммитом, когда E3 закроется.

### 19. Как ведётся Epic, пока Harness не на Node

Harness и Profile worfy на этот ПК не ставились (решение владельца 2026-10-09: plugin с bash-hook-ами
может сломать каждую Session ПК). Реестра Gate (`gate/config.json`) и Profile нет, поэтому `profile`,
`preflight` и `gate.sh` отвечают «project not determined». Session на Windows работает так:

- **Статус Ticket-а** — `node harness/bin/ticket show <epic> <NN>` (проверено: `ticket show
  worfy-windows 01` → EXIT=0, `01-проверка-фактов-на-живой-windows.md:4  Status: open`). Менять
  Status: `node harness/bin/ticket claim|done|block …` из Git Bash. Строки `Status:` Ticket-ов этого
  Epic-а, пока Epic ведётся с Mac, правит Session на Mac.
- **epic-status** — только из Git Bash (Bash tool), не из PowerShell: там `bash` — WSL.
  `bash harness/bin/epic-status worfy-windows` → EXIT=0, строка `/to-tickets · worfy-windows 0/17 ·
  worfy-windows/01 · ticket 01 — …`. С `--json`: `bash harness/bin/epic-status --json > "$TMP/es.json"`
  → EXIT=0; отбор на node — пункт «Готово, когда» Ticket-а 01.
- **Проверка вместо Gate.** Gate (`gate.sh`) на ПК не запускается: нет реестра Gate. Проверка
  ветки — `pnpm lint`, `pnpm typecheck`, `pnpm test` с exit code каждой команды; отчёт прямо пишет
  «Gate не запускался». Пока не влит Ticket 02, все три идут с
  `--config.verify-deps-before-run=false`, а `test` ещё с `--config.shell-emulator=true` (разделы 10,
  17); падения `pnpm test` сверяются со списком раздела 17.
- **preflight** не запускается (`profile unreadable`, EXIT=2). Его шаги делаются руками: `git fetch`,
  `git status`, ветка от `origin/main`, открытые PR.
- **Открытые PR worfy-link перед Wave** (Q12, ADR-0056), пока этого не делает skill `epic-wave`
  (Ticket 07). `gh` умеет `--jq` без внешнего `jq`:

  ```
  $ gh pr list -R IDSAD-XL/worfy --state open --json number,headRefName,files --jq '.[] | select(.headRefName|startswith("worfy-windows/")|not) | "#\(.number) \(.headRefName) \(.files|length) files"'
  #169 worfy-link/09 43 files
  #150 worfy-harness/22 27 files
  EXIT=0
  ```

  Затем `gh pr view <N> --json files --jq '.files[].path'` и сверка с «Где в коде» Ticket-ов Wave.
  Ticket с общим файлом не берётся, пока тот PR не влит. Мерж — только Session на Mac.
- **Вызов скриптов `bin` по shebang** в Bash tool работает (Git Bash): `./harness/bin/profile` и
  `./harness/bin/epic-status` → EXIT=0. Из node (`execFile`, `spawnSync`) — нет (`epic-board`,
  ENOENT).

### 20. NoDefaultCurrentDirectoryInExePath в процессах Claude Code

```
PS> "proc=[$env:NoDefaultCurrentDirectoryInExePath]"; [Environment]::GetEnvironmentVariable(…,'User'); (…,'Machine')
proc NoDefaultCurrentDirectoryInExePath=[1]
user=[]
machine=[]
```

Рядом в том же процессе: `CLAUDECODE=1`, 22 переменные `CLAUDE_CODE_*` (`SESSION_ID`, `ENTRYPOINT`,
`HOST_SESSION_ID`, `MESSAGING_SOCKET`, `MESSAGING_TOKEN`, `OAUTH_SCOPES`, `USER_EMAIL` и другие),
`CLAUDE_AGENT_SDK_*`, `CLAUDE_PID`, `CLAUDE`. Переменная `NoDefaultCurrentDirectoryInExePath` есть
и в окружении hook-ов (раздел 13). Вывод: всё, что запускают Session Claude Code и её
hooks, получает `NoDefaultCurrentDirectoryInExePath=1`; cmd.exe тогда не находит `.bat` из текущей
папки без `.\`. Так падает пересборка node-pty (раздел 08).

### 21. CRLF в скриптах под Git Bash

```
$ printf '#!/usr/bin/env bash\r\nset -euo pipefail\r\nfoo=1\r\nif [ "$foo" = 1 ]; then echo "ok-crlf"; fi\r\n' > crlf.sh
$ bash crlf.sh      → ok-crlf   bash-file EXIT=0
$ ./crlf.sh         → ok-crlf   shebang EXIT=0
$ shopt igncr       → bash: shopt: igncr: invalid shell option name
```

Вывод: bash Git for Windows 5.2.26 выполняет скрипт с CRLF без ошибок — и через `bash файл`, и по
shebang. `epic-status` с CRLF в рабочем дереве дал EXIT=0 и валидный JSON (раздел 18). Как CRLF ведёт
себя в WSL, Linux и macOS, здесь не проверялось.

### 22. Symlink без режима разработчика

```
PS> Get-ItemProperty HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock | Select AllowDevelopmentWithoutDevLicense
(значения нет — режим разработчика выключен)
PS> whoami /groups → Обязательная метка\Средний обязательный уровень (без повышения)
PS> git config --get core.symlinks → false
pnpm test: Error: EPERM: operation not permitted, symlink '…\outside' -> '…\Repo\out-link'   (7 файлов test-ов, раздел 17)
```

Вывод: без режима разработчика и без прав администратора `fs.symlink` на этом ПК даёт EPERM.

### 23. procStart в sessions/<pid>.json

```
PS> Get-Content $env:USERPROFILE\.claude\sessions\51020.json | ConvertFrom-Json
pid 51020, procStart 134359831229530706, startedAt 1791509524149, cwd C:\Users\Alexey\Desktop\Slop\worfy-wrapper, kind interactive
PS> Get-CimInstance Win32_Process -Filter "ProcessId=51020"
CreationDate=2026-10-09T04:32:02.9530700+03:00 name=claude.exe
```

134359831229530706 × 100 нс от 1601-01-01 = 2026-10-09T01:32:02.953Z — ровно `CreationDate`.
Вывод: на Windows Claude Code пишет в `procStart` время старта процесса как FILETIME (десятичная
строка); его даёт `Get-CimInstance Win32_Process` (`CreationDate`).

### 24. Код E3 на main 76f7ff8 и 8cabc65

Ticket-ы 13 и 15 писались по планам E3 на `4f983ef`. Сверка с main `76f7ff8`:

```
$ for f in src/main/first-run/checks.ts src/main/first-run/actions.ts src/shared/ipc/first-run.ts src/main/harness/install.ts src/main/harness/migrate/plan.ts src/main/harness/migrate/apply.ts src/main/harness/bundled.ts src/main/harness/qmd.ts src/renderer/shell/FirstRun.tsx; do [ -e "$f" ] && echo "есть $f"; done
есть … (все 9)
$ grep -n "brew install\|'jq'" src/main/first-run/checks.ts
10:// - git, gh, node 22 or newer, jq: `--version`. Missing is `fail` with `brew install <tool>`; worfy
132:  { id: 'jq', group: 'Command-line tools', title: 'jq' },
237:  const install = `brew install ${name}`
$ cat harness/.mcp.json
{ "mcpServers": { "qmd": { "command": "${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp" } } }
$ grep -m1 '^Status' .scratch/worfy-harness/issues/{12,13,14,15,17,18,19,21}-*.md
E3/12 done (PR #117) · E3/13 done (#132) · E3/14 done (#136) · E3/15 done (#134) · E3/17 done (#145) · E3/18 done (#147) · E3/19 done (#148) · E3/21 done (#141)
$ ls harness/hooks/tests/
gate-notverified.test.sh gate-unregistered.test.sh gate-verdict.test.sh gh-token-env.test.sh rules-hooks.test.sh session-hooks.test.sh
```

Файлы сборки после `4f983ef` (для Ticket-а 12):

```
$ git log --oneline 4f983ef..origin/main -- electron-builder.yml scripts/install-stable.sh package.json
d0a0ba2 worfy-link/02: Link a machine — … (#158)            → electron-builder.yml, package.json
a8cd1a2 worfy-link/01: link server between Machines … (#154) → package.json
7893df3 worfy-harness/27: Harness eval cases … (#142)        → package.json
77e4490 worfy: HANDOFF is a snapshot again … (#139)          → package.json
4bdfb5a worfy-harness/15: the status line bridge ships in the .app (#134) → electron-builder.yml
$ grep -n '"postinstall"\|"test":' package.json
16:    "test": "ELECTRON_RUN_AS_NODE=1 electron ./node_modules/vitest/vitest.mjs run",
21:    "postinstall": "electron-rebuild --only node-pty"
```

Повтор на main `8cabc65` (после мержа PR #172):

```
$ for f in <те же 9 файлов>; do [ -e "$f" ] && echo "есть $f" || echo "НЕТ $f"; done
есть … (все 9)
$ grep -n "brew install\|'jq'" src/main/first-run/checks.ts
10, 132, 235, 237, 262, 373 — те же строки (10: `brew install <tool>`, 132: проверка jq, 237: `brew install ${name}`)
$ cat harness/.mcp.json
{ "mcpServers": { "qmd": { "command": "${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp" } } }
$ git diff --stat 76f7ff8 HEAD -- src/main/first-run src/shared/ipc/first-run.ts src/main/harness harness/.mcp.json harness/bin/qmd-collections src/renderer/shell/FirstRun.tsx
 src/renderer/shell/FirstRun.tsx | 3 ++-
 1 file changed, 2 insertions(+), 1 deletion(-)
```

Вывод: экран первого запуска, установщик Harness, форма переноса, мост Limits, qmd (`qmd.ts`,
`qmd-collections`, `.mcp.json`) и hook `gh-token-env.sh` E3 уже на main — на `76f7ff8` и на
`8cabc65`; между ними из этих файлов менялся только `FirstRun.tsx` (3 строки). Проверка `jq` на
экране первого запуска есть, подсказки — `brew install`.

### 25. pwsh из MSIX глазами node

```
$ node -e "…fs.existsSync / statSync / lstatSync('C:/Users/Alexey/AppData/Local/Microsoft/WindowsApps/pwsh.exe')"
existsSync false
stat err EACCES
lstat symlink true size 85
```

Вывод: `pwsh.exe` из winget-пакета MSIX — псевдоним (app execution alias) в
`%LOCALAPPDATA%\Microsoft\WindowsApps`. `fs.existsSync` его не видит, `fs.statSync` — `EACCES`, а
node-pty его запускает (раздел 09). Поиск «файл есть в `Path`» через `existsSync` такой pwsh
пропустит.

### 26. Что Session оставила вне клона

Создано этой Session за пределами клона и `%TEMP%\worfy-01\` (все — с согласия владельца или как
побочный эффект проверки):

- три папки в `%USERPROFILE%\.claude\projects` (раздел 12) — удалены после сверки, с согласия
  владельца; `C:\a\b` осталась: удаление в корне `C:` заблокировано защитой Session, её удаляет
  владелец;
- `%USERPROFILE%\.claude\projects\C--Users-Alexey-AppData-Local-Temp-worfy-01-hook-cwd` и две папки
  `%USERPROFILE%\.claude\session-env\<id>` (`ea64eef0-…`, `7ad1a86e-…`) — от проб hooks (раздел 13);
  Claude Code создаёт их и при `--no-session-persistence`. Удалены с согласия владельца;
- `C:\Users\Alexey\.cache\qmd` — пустая папка от первого `qmd status` (раздел 15); удалена, сама
  `.cache` была и раньше;
- worktree `C:\Users\Alexey\worfy\.claude\worktrees\windows-long-path-probe-0123456789abcdefg` и
  ветка `probe/windows-long-path-probe-0123456789abcdefg` в клоне (раздел 11) — удалены;
- PowerShell 7.6.6 (winget) и pnpm 11.22.0 в node 22.13.0 (nvm); node 22.13.0 активен в nvm.
