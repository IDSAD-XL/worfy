# 09 — Окружение агента на Windows: PATH без login shell, Git Bash для Claude Code, claude.exe

Type: task
Status: done 2026-10-09
PR: #194
Blocked by: 02
Source: решения владельца 2026-10-07: Q1 (полный порт worfy под Windows), Q18 (Git for Windows обязателен), Q24 (Windows 10 21H2+ и 11, только x64) ([spec.md](../spec.md)); [ADR-0054](../../../docs/adr/0054-full-windows-port.md) «Full Windows port» (пункты 3 и 4; «Что меняется в прежних ADR» — ADR-0007); [ADR-0007](../../../docs/adr/0007-claude-code-launch-environment.md) (окружение Claude Code — login shell); [ADR-0008](../../../docs/adr/0008-claude-code-native-binary-path.md) (нативный бинарник из пакета SDK)

## Что происходит

- Окружение процесса Claude Code собирает `src/main/agent/env.ts` (ADR-0007). worfy один раз
  запускает `$SHELL -ilc` (`captureLoginShellEnv`, `:82-106`); без `SHELL` — `/bin/zsh` (`:84`).
  Shell стартует из минимального окружения: ключи `SHELL_BASE_KEYS` и POSIX
  `SYSTEM_PATH=/usr/bin:/bin:/usr/sbin:/sbin` (`:16-17`, `shellBaseEnv` `:26-33`). Внутри shell —
  `printf` и `env -0` (`:87`).
- На Windows нет ни `$SHELL`, ни `/bin/zsh`. По коду `execFile` падает, и `captureLoginShellEnv`
  отдаёт запасное окружение (`:88`, `:102`). В нём `PATH` — POSIX-строка, а `SystemRoot`,
  `USERPROFILE` и `Path` Windows нет: `SHELL_BASE_KEYS` их не берут. Claude Code с таким окружением
  не найдёт git, node и gh. На Windows это не запускалось.
- Это окружение берут три места: Session-ы (`src/main/agent/app-registry.ts:50-55`), `gh` для
  бейджей PR (`src/main/ipc/checks.ts:72-75`) и Terminal (`src/main/ipc/terminal.ts:137`). Что
  Terminal запускает на Windows — Ticket 10.
- Зачем ADR-0007 минимальное окружение на входе shell: worfy, запущенный из Bash tool Session-а
  Claude Code (`pnpm dev`), наследует её переменные — `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`,
  `ANTHROPIC_BASE_URL` и другие (в spike ADR-0007 их было 29). Через shell они не проходят. На
  Windows-ПК так и будет: Session Epic-а запускает `pnpm dev` из своего Bash tool. Если взять
  `process.env` как есть, эти переменные уйдут в дочерний Claude Code.
- Имена переменных на Windows не различают регистр. В копии `{ ...process.env }` ключ пути — обычно
  `Path`. При запуске дочернего процесса Node сортирует ключи `env` и берёт первый из совпадающих без
  учёта регистра (документация `child_process`, `options.env`): `PATH` и `Path` в одном объекте —
  источник ошибок. `withoutApiKeys` (`:54-58`) удаляет ключи по точному имени, а на Windows
  `anthropic_api_key` — та же переменная, что `ANTHROPIC_API_KEY`.
- **Git Bash.** Без него у Claude Code на Windows нет Bash tool, hooks с matcher `Bash` молчат
  (ADR-0054, документация hooks Claude Code). Путь к Git Bash можно задать переменной
  `CLAUDE_CODE_GIT_BASH_PATH` — она есть в списке переменных SDK
  (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`). worfy её не задаёт: `grep -rn GIT_BASH
  src` пуст. На ПК владельца Claude Code 2.1.233 без этой переменной нашёл
  `C:\Program Files\Git\bin\bash.exe` (так `SHELL` у hook-а), хотя первым `bash` в PATH стоит WSL;
  как он ищет — не установлено (evidence Ticket-а 01, разделы 04 и 13). `bash.exe` из PATH
  ненадёжен: на ПК первый — `C:\Windows\System32\bash.exe`, запуск WSL, и он даже не стартует (WSL2
  без виртуализации, EXIT=1; раздел 04). В постоянном PATH ПК из Git только `C:\Program Files\Git\cmd`.
- **Переменные родительской Session на ПК.** Процесс Session Claude Code несёт `CLAUDECODE=1`,
  `CLAUDE_CODE_*` (22 имени, среди них `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_ENTRYPOINT`,
  `CLAUDE_CODE_MESSAGING_*`), `CLAUDE_AGENT_SDK_*`, `CLAUDE_PID` и `NoDefaultCurrentDirectoryInExePath=1`.
  Последней нет в реестре User и Machine (evidence, раздел 20); с ней cmd.exe не находит `.bat` в
  текущей папке — так на ПК падает пересборка node-pty (раздел 08). `pnpm dev` из Bash tool отдаст
  всё это worfy.
- **Бинарник.** В упакованной сборке `claudeExecutablePath` (`src/main/agent/options.ts:51-54`)
  отдаёт `<resources>/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude`.
  В пакете `claude-agent-sdk-win32-x64` файл называется `claude.exe`: на ПК pnpm поставил
  `@anthropic-ai/claude-agent-sdk-win32-x64@0.3.289`, `claude.exe --version` — `2.1.289 (Claude
  Code)`, EXIT=0 (evidence Ticket-а 01, раздел 14). В `pnpm dev` путь не задаётся, бинарник ищет SDK
  (`:52`).
- **Test-ы.** `test/unit/agent-env.test.ts` гоняет настоящий zsh только на Mac (`onMac`, `:30`).
  `test/unit/agent-executable.test.ts:13-37` ждёт путей `darwin`. На ПК `agent-executable.test.ts` —
  2 упавших (`'\Applications\worfy.app\…'` вместо `'/Applications/…'`), `agent-env.test.ts` в
  списке упавших нет (evidence, раздел 17).
- E3 (`worfy-harness`) ещё открыт. Его Ticket-ы 17, 18 и 19, которые опираются на `env.ts` и
  `options.ts` (qmd, `GH_TOKEN` через hook, экран первого запуска), уже влиты (evidence Ticket-а 01,
  раздел 24); PR #150 (E3 Ticket 22) влит как `3837558`. Открытый E3 Ticket 23 (worfy читает Silent
  Project) меняет `src/main/workflow/reader.ts`, `src/main/workflow/profile.ts` и их contract test-ы —
  не файлы этого Ticket-а, но их же берёт Ticket 05. Строки выше — main 4f983ef. Перед началом
  перечитать `src/main/agent/env.ts`, `src/main/agent/options.ts` и
  `src/main/agent/app-registry.ts` на свежем main.

## Что делаем

1. **Окружение на Windows без login shell** (Q18, ADR-0054). `agentEnv()` на `win32` shell не
   запускает. *После ревью PR #194 основа другая:* не окружение процесса минус переменные
   родительской Session, а сборка как при новом входе — переменные сеанса по списку, реестр машины и
   пользователя, без ключей API (ADR-0057, Итог). План ниже — первый вариант, оставлен для истории.
   Основа — окружение процесса worfy. Из него убираются:
   - `ANTHROPIC_API_KEY` и `ANTHROPIC_AUTH_TOKEN`, как на Mac; имя сравнивается без учёта регистра;
   - переменные родительской Session Claude Code: имена с началом `CLAUDE` или `ANTHROPIC_` (без
     учёта регистра) и `NoDefaultCurrentDirectoryInExePath` (evidence Ticket-а 01, раздел 20),
     которых нет в постоянном окружении пользователя. Постоянное окружение — реестр:
     `HKCU\Environment` и `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment`,
     команда `reg query`. Так переменная, заданная самим пользователем (`setx ANTHROPIC_MODEL …`),
     доходит до Claude Code — как на Mac доходит экспорт из rc-файла (ADR-0007).
   - Если `reg query` не ответил, убираются все такие переменные, а `error` результата говорит
     почему — как у запасного окружения на Mac (`env.ts:88`).

   `PATH` остаётся как есть. Ключ пути ищется без учёта регистра; второй ключ (`PATH` рядом с
   `Path`) не появляется. `CapturedEnv.from` получает значение для Windows, например `'process'`.
   Окружение процесса, ответ `reg query` и проверка файлов передаются в функцию параметрами — для
   test-ов.
2. **Git Bash для Claude Code** (Q18). В `src/main/agent/env.ts` — экспортируемые `findOnPath` (поиск
   `<имя>.exe` по `Path` окружения; псевдоним MSIX в `WindowsApps`, например pwsh из winget, —
   найденный файл, хотя `fs.existsSync` для него false: evidence Ticket-а 01, раздел 25) и
   `findGitBash`. Тот же helper потом берут экран первого
   запуска (Ticket 13), Terminal (Ticket 10) и test-ы Harness на Windows (Ticket 14). Порядок поиска:
   - от `git.exe` из `Path`: корень Git for Windows — папка над `cmd`, `bin` или `mingw64\bin`, в
     которой лежит `git.exe`; Git Bash — `<корень>\bin\bash.exe`;
   - иначе `%ProgramFiles%\Git\bin\bash.exe`, затем `%LOCALAPPDATA%\Programs\Git\bin\bash.exe`
     (установка Git только для пользователя);
   - `%SystemRoot%\System32\bash.exe` (WSL) не берётся никогда.

   Git Bash найден и у пользователя нет своей `CLAUDE_CODE_GIT_BASH_PATH` — worfy задаёт её в
   окружении агента. Своя есть — не трогается. Git Bash не найден — переменная не задаётся, `error`
   говорит: «Git Bash not found: the agent has no Bash tool». Экран первого запуска покажет это
   отдельно (Ticket 13).
3. **claude.exe** (ADR-0008). `claudeExecutablePath` на `win32` отдаёт
   `<resources>\app.asar.unpacked\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe`.
   Путь собирается через `path.win32`, чтобы unit-test на Mac сверял его с `\`. На Mac путь прежний.
   Что файл лежит в установленной сборке, проверяет Ticket 12.
4. **Mac и Linux не меняются.** `captureLoginShellEnv`, `SYSTEM_PATH` и `SHELL_BASE_KEYS` — как
   сейчас на всех системах, кроме `win32`. Шапки `env.ts` (`:1-9`) и `options.ts` (`:7-10`, `:46-50`)
   говорят и про Windows.
5. **ADR.** ADR-0054 оставляет выбор окружения агента на Windows этому Ticket-у. Решение — новый ADR
   (номер выдаёт ship-ticket при мерже): окружение процесса без ключей API и без переменных
   родительской Session, Git Bash через `CLAUDE_CODE_GIT_BASH_PATH`, `claude.exe`. ADR-0007 принят и
   не правится; новый ADR ссылается на него и на ADR-0054.
6. **Test-ы своего среза.** `test/unit/agent-executable.test.ts` (упал на ПК, evidence Ticket-а 01,
   раздел 17) и `test/unit/agent-env.test.ts` — зелёные на ПК.
   Test-ы `onMac` (`agent-env.test.ts:30`) не трогаем: пять test-ов `skipIf(platform !== 'darwin')`
   разбирает Ticket 14.

**Не входит:** оболочка Terminal (Ticket 10); проверки машины на первом запуске (Ticket 13); вызов
скриптов Harness через `node` (Ticket 05).

## Готово, когда

- [x] Unit `test/unit/agent-env.test.ts`, платформа `win32` передана в функцию: login shell не
  запускается; `ANTHROPIC_API_KEY` и `anthropic_auth_token` удалены; `CLAUDECODE`,
  `CLAUDE_CODE_SESSION_ID` и `ANTHROPIC_BASE_URL` из окружения процесса удалены; `ANTHROPIC_MODEL`,
  которая есть в фикстуре ответа `reg query`, осталась; ключ `Path` один, значение прежнее.
- [x] Unit: `reg query` не ответил — все `CLAUDE*` и `ANTHROPIC_*` удалены, `error` не пуст.
- [x] Unit `findGitBash` на фикстуре файлов: Git Bash находится от `git.exe` в `<Git>\cmd`,
  `<Git>\bin` и `<Git>\mingw64\bin`, затем по `%ProgramFiles%` и `%LOCALAPPDATA%\Programs`;
  `C:\Windows\System32\bash.exe` не берётся; своя `CLAUDE_CODE_GIT_BASH_PATH` не перезаписывается;
  без Git Bash переменной нет, `error` называет причину.
- [x] Unit `test/unit/agent-executable.test.ts`: упакованная сборка `win32`/`x64` →
  `<resources>\app.asar.unpacked\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe`;
  ожидания `darwin` (`:18-21`) не меняются; test `:29-37` на Windows ждёт `claude.exe`.
- [x] Test только для `win32` (`it.runIf(process.platform === 'win32')`) в
  `test/unit/agent-env.test.ts`: настоящий `agentEnv()` даёт окружение, в котором `where.exe`
  находит `git`, `node` и `gh`, а `CLAUDE_CODE_GIT_BASH_PATH` указывает на существующий `bash.exe`
  вне `System32`.
- [x] Windows-ПК: `pnpm test test/unit/agent-env.test.ts test/unit/agent-executable.test.ts` —
  exit 0; test-ы `win32` выполнены, а не пропущены (вывод vitest).
- [x] Windows-ПК, проверка платформенного PR (Q23, ADR-0056): gate full — строка вердикта и код выхода
  в отчёт. Пока Gate не на Node (Ticket 03) — `pnpm lint`, `pnpm typecheck`, `pnpm test` с кодами
  выхода и пометка «Gate не запускался». Падения `pnpm test` сверены со списком Ticket-а 02: новых
  нет.
- [ ] (вручную) Windows-ПК, `pnpm dev`: новая Session отвечает. На просьбу выполнить
  `git --version && node --version && gh --version` агент вызывает Bash tool, в ответе три версии.
  Как проверить: окно worfy, Session Node.
- [ ] Mac: test-ы `onMac` в `test/unit/agent-env.test.ts` зелёные с прежними ожиданиями; gate full
  на Mac зелёный (по правилу needs-mac-gate: проверяет и вливает Session на Mac).
- [x] ADR об окружении агента на Windows лежит в `docs/adr/` и ссылается на ADR-0007 и ADR-0054.

## Тесты

Сначала падающий test — unit `claudeExecutablePath` для `win32` в
`test/unit/agent-executable.test.ts`: сейчас путь без `.exe` и с `/`. Затем unit окружения на
`win32` в `test/unit/agent-env.test.ts`: сейчас `agentEnv()` на любой системе запускает shell.

Ветка `win32` проверяется на Mac и в Linux CI: платформа, окружение процесса, ответ `reg query` и
проверка файлов — параметры. Test с настоящим `agentEnv()` идёт только на `win32`; на Windows-ПК он
обязателен. В «Итог» — как test-ы падали до правки.

## Где в коде

- `src/main/agent/env.ts`
- `src/main/agent/options.ts`
- `test/unit/agent-env.test.ts`
- `test/unit/agent-executable.test.ts`
- `test/unit/agent-query-factory.test.ts` (ожидание пути `claude.exe` на `win32`)
- `docs/adr/0057-agent-environment-on-windows.md` (новый)

`src/main/agent/app-registry.ts`, `src/main/ipc/checks.ts` и `src/main/ipc/terminal.ts` берут
окружение через `agentEnv()` и не меняются. ADR этого Ticket-а — новый файл в `docs/adr/`, имя с
номером даёт ship-ticket.

## Итог

Ветка `worfy-windows/09` от main `a84d551`; прогоны — на ПК владельца из Session Claude Code.

- **Окружение на Windows** (`src/main/agent/env.ts`, ADR-0057). `captureAgentEnv` выбирает путь по
  платформе: на `win32` — `captureWindowsEnv` без login shell, на остальных — `captureLoginShellEnv`,
  как было. На Windows окружение собирается как при новом входе: переменные сеанса из процесса по
  списку `WINDOWS_SESSION_VARS` (`SystemRoot`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`,
  `ProgramFiles*` …), сверху — постоянные переменные реестра (через Windows PowerShell) машины, затем пользователя
  (`REG_EXPAND_SZ` раскрываются, `Path` — машины, затем пользователя, под одним ключом), без
  `ANTHROPIC_API_KEY` и `ANTHROPIC_AUTH_TOKEN` при любом регистре. Из процесса больше не берётся ничего:
  `GH_TOKEN`, `GITHUB_TOKEN`, `WORFY_*`, `CLAUDECODE`, `CLAUDE_CODE_*`, `NoDefaultCurrentDirectoryInExePath`
  родительской Session до агента не доходят. Без ответа реестра — переменные сеанса и `Path`
  процесса, `from: 'fallback'`, `error` говорит почему; обычно `from: 'registry'`.
  - Раскрытие — как при входе в Windows (`putKey`, алгоритм из третьего ревью PR #194): сначала ключ
    машины до финальных значений, потом ключ пользователя поверх. В ключе `REG_SZ` — как есть;
    `REG_EXPAND_SZ` ждёт, пока переменные, на которые он ссылается, станут финальными, и получает их
    значения один раз, без повторного сканирования. `Path` — машины, затем пользователя. Так
    `%NVM_HOME%` в `Path` находит `NVM_HOME` ниже в том же ключе, а `%PATHEXT%` в пользовательском
    `PATHEXT` — машинное значение.
  - Предыдущие варианты: раскрытие сразу при чтении (второе ревью: ссылка вперёд оставалась
    буквальной) и два прохода по сырым значениям обоих ключей (третье ревью: пользовательский
    `PATHEXT=%PATHEXT%;.PY` давал `%PATHEXT%;.PY;.PY;.PY;.PY`). На ПК владельца в реестре таких
    ссылок нет (в `Path` только `%SystemRoot%` и `%USERPROFILE%`, `PATHEXT` и `PSModulePath` только у
    машины), поэтому здесь ни одна ошибка не проявлялась.
  - Чтение реестра (четвёртое ревью): `reg query` заменён на Windows PowerShell по абсолютному пути
    (`powershellRegRead`, `registryScript`, `parseRegistryValues`): `GetValue(…,
    'DoNotExpandEnvironmentNames')`, имя и значение в base64 от UTF-8. Проверено на ПК временным
    ключом `HKCU\Software\worfy-probe` (создан и удалён, `reg query` после удаления — exit 1): значение
    `C:\Users\Алексей\日本\😀\%USERPROFILE%` через `reg query` как UTF-8 читается как
    `C:\Users\����ᥩ\??\??\%USERPROFILE%`, как CP866 — `C:\Users\Алексей\??\??\%USERPROFILE%`
    (`chcp` — 866), через PowerShell — без потерь. Точка подмены для test-ов — `readKey` (значения
    ключа уже разобранными), вместо `regQuery`.
  - Там же: предел 32 767 символов на значение (длиннее — остаётся как есть), запасное окружение без
    частей реестра (реестр собирается отдельно), без пустого `Path`, в `WINDOWS_SESSION_VARS` —
    `USERDNSDOMAIN`, `ProgramFiles(Arm)`, `CommonProgramFiles(Arm)`.
  - Пятое ревью: значение обрезается по первому NUL, имя с NUL отбрасывается (иначе Node отказывает в
    `spawn` любого агента); предел 32 767 «липкий»; ключ открывается через .NET Registry API, подключ
    в base64; запуск PowerShell — чистая `powershellCommand` (абсолютный путь, `-NoProfile`,
    `-NonInteractive`, timeout, `windowsHide`; пустой или не абсолютный `SystemRoot` — `C:\Windows`);
    в ошибке — сообщение скрипта, «timed out after 10 s» или последняя строка stderr; весь
    `WINDOWS_SESSION_VARS` закреплён test-ом.
  - **Долг:** пользовательское значение `P2=%Path%` получает только `Path` пользователя, а итоговый
    `Path` — машины и пользователя. Как поступает сама Windows, не проверено; случай редкий.
  - **Долг:** скрипт идёт через `-EncodedCommand`; средства защиты могут его помечать. Передача через
    stdin (`-Command -`) не сделана: многострочный скрипт в этом режиме читается построчно, как в
    интерактивной консоли, — нужна отдельная проверка. **Закрыт 2026-10-13, PR #269 (Ticket 21):**
    скрипт идёт постоянным текстом через `-Command`, `-EncodedCommand` больше нет (ADR-0062).
  - **После мержа (low из последнего комментария PR #194), сделано в PR Ticket-а 08:**
    - stderr `powershell.exe` при перенаправлении — CLIXML даже с `-OutputFormat Text` (проверено на
      ПК, exit 1 в обоих случаях): «последняя строка» была строкой XML. Теперь `stderrLine` берёт
      первую строку из `<S S="Error">`. **Долг:** текст ошибки PowerShell локализован и приходит в
      OEM-кодировке, на русской Windows он искажён (`�� 㤠����…`); свои ошибки скрипт отдаёт в
      base64 через stdout и этим не страдает;
    - `SystemRoot` вида `\Windows` (корень текущего диска) проходил `win32.isAbsolute`; теперь
      нужен диск и его корень, иначе `C:\Windows` (test);
    - test отказа только машинного ключа добавлен;
    - строки Итога с `reg query` и счёт мутантов (38, из них 17 новых) поправлены; комментарий
      `options.ts:109` называет и Linux.
  - **Долг:** нет test-ов, что `timeout` и `windowsHide` доходят до `execFile` (`runFile` передаёт
    `options` как есть), и что `SystemRoot` из окружения процесса доходит до читателя реестра.
  - Переменные входа из `HKCU\Volatile Environment` (`LOGONSERVER`, `HOMESHARE`,
    `USERDOMAIN_ROAMINGPROFILE`, `SESSIONNAME`, `CLIENTNAME`) — тоже в `WINDOWS_SESSION_VARS`.
  - Первый вариант (окружение процесса минус `CLAUDE*`/`ANTHROPIC_*`) отвергнут на ревью PR #194:
    прочие переменные того, кто запустил worfy, доходили до агента. Он записан в ADR-0057, раздел
    «Considered Options».
- **Git Bash** — `findOnPath` и `findGitBash`, экспортируются. `findOnPath` видит и псевдоним MSIX
  (`pwsh.exe` из winget; evidence Ticket-а 01, раздел 25) — проверено test-ом на этом ПК. `findGitBash`:
  от `git.exe` в `Path` (`cmd`, `bin`, `mingw64\bin`), затем `%ProgramFiles%\Git`,
  `%LOCALAPPDATA%\Programs\Git`; ничего под `%SystemRoot%`, WSL-овский `bash.exe` первым в `Path` не
  берётся. Без Git Bash — `error` «Git Bash not found: the agent has no Bash tool».
- **`claude.exe`** (`src/main/agent/options.ts`): путь собирается разделителями платформы сборки —
  `win32` для Windows, `posix` для остальных; на Windows-машине ожидания `darwin` теперь тоже верны.
- **ADR-0057** «Окружение агента на Windows» — ссылается на ADR-0007, ADR-0008 и ADR-0054; раздел
  «Considered Options». Номер 0057 — следующий свободный на main, в открытых PR других ADR нет.
- **Как test-ы падали до правки** (код main, новые test-ы): `test/unit/agent-env.test.ts` — файл
  упал при загрузке (`TypeError: Cannot read properties of undefined (reading '0')`, нет
  `PERSISTENT_ENV_KEYS`); `test/unit/agent-executable.test.ts` — 3 из 9 (`'\Applications\…'` вместо
  `'/Applications/…'`, `claude` вместо `claude.exe`).
- **Мутанты** (на Windows, по одному). Первый круг: проверка платформы `'win32'` → `'darwin'` — 10
  красных; `'claude'` вместо `'claude.exe'` — 2; без отказа от папки Windows в `findGitBash` — 1.
  Второй круг, после ревью: всё окружение процесса вместо списка сеанса — 3 красных; без фильтра
  ключей API — 1; без раскрытия `REG_EXPAND_SZ` — 2; реестр пользователя раньше машины — 2. После
  третьего ревью (`putKey`, по одному на `agent-env.test.ts`): раскрытие сразу при чтении — 5
  красных; один проход по ждущим значениям — 1; сырое значение пользователя заменяет машинное до
  раскрытия — 2; повторное сканирование подставленного текста — 1; раскрытие `REG_SZ` — 1; ключ
  пользователя раньше машины — 7; `Path` пользователя заменяет машинный — 4; без значений из цикла —
  1. Новая таблица на коде `442c871` — 5 красных из 9 строк (PATHEXT, PSModulePath, `REG_SZ`, цикл,
  машинный ключ не видит пользовательскую переменную). После четвёртого ревью — 21 мутант, все
  красные: 8 прежних и 13 новых (пункты a–f ревью — регистр ключа API, регистр в `setVar`, регистр в
  ссылке вперёд, пустой `Path` пользователя, остаток цикла без раскрытия, `;` в имени; без предела
  длины, `>=` вместо `>`, запасное окружение с частью реестра, пустой `Path`, base64 как latin1, чтение
  с раскрытием, без `USERDNSDOMAIN`). После пятого ревью — 38 мутантов, все красные: 21 прежний и
  17 новых (без обрезки по NUL, без отбрасывания имени с NUL, нелипкий предел, голый
  `powershell.exe`, без `-NoProfile`, без `-NonInteractive`, без timeout, `windowsHide: false`,
  `SystemRoot` не учитывается, пустой `SystemRoot` принят, ошибка ключа пользователя проглочена как
  `[]`, без текста о timeout, без сообщения скрипта, без строки stderr, перепутанные HKCU/HKLM,
  без отказа на отсутствующий ключ, без `OS` в списке сеанса).
- **Test-ы на Windows-ПК:** `pnpm test test/unit/agent-env.test.ts test/unit/agent-executable.test.ts
  test/unit/agent-query-factory.test.ts` — exit 0 (после пятого ревью `agent-env.test.ts` — `57 passed | 4 skipped (61)`; после четвёртого — `50
  passed | 4 skipped (54)`, с test-ами читателя реестра на временном ключе
  `HKCU\Software\worfy-test-registry-reader`; после третьего — `37 passed | 4 skipped (41)`; после
  второго ревью `agent-env.test.ts` — `30
  passed | 4 skipped (34)`: добавлены случай порядка раскрытия и случай с настоящим реестром и
  подложенными `CLAUDECODE`, `GH_TOKEN`, `ANTHROPIC_API_KEY` в окружение процесса; test псевдонима
  MSIX без псевдонима — `ctx.skip()`), до него — `Tests 50 passed | 4 skipped (54)`; пропущены
  4 test-а `onMac`. Test-ы `win32` выполнены: настоящий `agentEnv()` — `from: 'registry'`, `error`
  null, `where.exe` находит `git`, `node`, `gh`, `CLAUDE_CODE_GIT_BASH_PATH` — существующий `bash.exe`
  вне `System32`, ключей `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`,
  `NoDefaultCurrentDirectoryInExePath`, `GH_TOKEN`, `ANTHROPIC_API_KEY` нет (сами test-ы идут внутри
  Session Claude Code, так что в `process.env` они есть); псевдоним MSIX `pwsh.exe` найден.
- **Проверка платформенного PR без Gate** (Gate на Node — Ticket 03, «Gate не запускался»), на
  коммите `f9f36bd`: `pnpm install --frozen-lockfile` — exit 0; `pnpm typecheck` — exit 0; `pnpm lint`
  — exit 1 (`no-useless-assignment` в новом test-е), правка — следующим коммитом, после неё `pnpm lint`
  — exit 0, `pnpm typecheck` — exit 0, `agent-env.test.ts` — `28 passed | 4 skipped`. `pnpm test` на
  `f9f36bd` — exit 1, `Test Files 52 failed | 114 passed (166)`, `Tests 695 failed | 2492 passed | 16
  skipped (3203)`. Сверка с main `9e4874b` по JSON-отчётам vitest (там `53 failed | 113 passed`, `697
  failed | 2466 passed | 16 skipped (3179)`): отличие одно — ушёл `agent-executable` (2 падения), его
  чинит этот Ticket. Новых падений нет. После второго ревью — то же: `pnpm lint` — exit 0, `pnpm
  typecheck` — exit 0, `pnpm test` — exit 1, `Test Files 52 failed | 114 passed (166)`, `Tests 695
  failed | 2494 passed | 16 skipped (3205)`, отличие от main одно — ушёл `agent-executable`. (В прогоне первого варианта `autopilot-limits` один раз упал
  по таймауту под нагрузкой; отдельно — 3 прогона из 3 зелёные, в этом прогоне не падал.)
- **Не проверено, нужен владелец:** ручной пункт «`pnpm dev`: новая Session отвечает и зовёт Bash
  tool». Новой Session нужен Project, а добавление Project-а с путём `C:\…` на Windows скорее всего ждёт Ticket-а 08 (схемы путей «absolute POSIX path»)
  (пути и папки на Windows).
