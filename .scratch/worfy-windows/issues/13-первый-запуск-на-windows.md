# 13 — Первый запуск на Windows: проверки машины и установщик Harness из E3

Type: task
Status: done 2026-10-18T11:18Z
PR: #479
Branch: worfy-windows/13-first-run
Blocked by: 04, 05, 12
Source: решения владельца 2026-10-07: Q18 (Git for Windows обязателен, подсказка `winget install Git.Git`), Q24 (Windows 10 21H2+ и 11, только x64), Q20 (Terminal на Windows — PowerShell: pwsh, иначе Windows PowerShell), Q19 (скрипты, которые зовут hooks и worfy, — на Node), Q22 (неподписанный установщик NSIS до E4); «Готово, когда» Epic-а, пункт 1 (подтверждено 2026-10-08); [ADR-0054](../../../docs/adr/0054-full-windows-port.md) «Full Windows port»; [ADR-0055](../../../docs/adr/0055-harness-scripts-in-node.md) «Harness scripts in Node»; [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md) (доставка Harness локальным marketplace); [ADR-0048](../../../docs/adr/0048-harness-plugin-spike-results.md) (команды `claude plugin`); Ticket-ы E3: [13](../../worfy-harness/issues/13-установщик-harness-из-app.md) (установщик Harness), [14](../../worfy-harness/issues/14-перенос-harness-из-claude-с-откатом.md) (форма переноса), [15](../../worfy-harness/issues/15-мост-limits-из-app.md) (мост Limits), [19](../../worfy-harness/issues/19-экран-первого-запуска.md) (экран первого запуска); [spec.md](../spec.md)

## Что происходит

- Экран первого запуска и установщик Harness приносит E3 (`worfy-harness`, Harness как часть
  worfy). На 4f983ef их кода ещё не было; на main `76f7ff8` и `8cabc65` E3 Ticket-ы 13, 14, 15 и 19 влиты, и все
  файлы из «Где в коде» есть: `src/main/first-run/checks.ts`, `actions.ts`,
  `src/shared/ipc/first-run.ts`, `src/main/harness/install.ts`, `migrate/plan.ts`, `migrate/apply.ts`,
  `src/renderer/shell/FirstRun.tsx` (evidence Ticket-а 01, раздел 24). В `checks.ts` — проверка
  `jq` (`:132`) и подсказка `brew install ${name}` (`:237`). Описание ниже — по планам E3; строки
  перечитать на свежем main.
- На ПК владельца `pnpm dev` открывает окно на экране First run (evidence, раздел 17).
  - Экран первого запуска (E3 Ticket 19, `src/main/first-run/checks.ts`) проверяет `git`, `gh`,
    `node` ≥ 22 и `jq` в окружении login shell. Чего нет — `fail` с подсказкой
    `brew install <что нет>`. Проверка отдаёт `ok`, `warn` или `fail`. Действие идёт только после
    окна подтверждения. Там же — `claude --version` из терминала против встроенной версии.
  - Установщик (E3 Ticket 13, `src/main/harness/install.ts`) копирует Harness этой сборки в
    `~/.claude/worfy-harness/plugin/`: сначала во временную папку рядом, потом переименование. Потом
    зовёт встроенный `claude`: `plugin marketplace add <папка>`,
    `plugin install worfy@<marketplace> --scope user`, при смене версии — `plugin update` (ADR-0048).
  - `statusLine` пишет только форма переноса (E3 Ticket 14, `src/main/harness/migrate/plan.ts`).
    Её строка есть, когда `statusLine` уже ведёт в мост Limits другой сборки. Она предлагает
    `<process.resourcesPath>/statusline-bridge.sh` с прежним аргументом. Других `statusLine` форма
    не трогает. Предлагать мост пользователю без `statusLine` E3 Ticket 15 оставил вопросом.
- Код, который уже есть:
  - `claudeHome()` — `join(homedir(), '.claude')` (`src/main/storage/paths.ts:40-43`). На Windows
    `homedir()` — `%USERPROFILE%`. `harnessHome()` — `<claudeHome>/worfy-harness`
    (`src/main/storage/paths.ts:52-55`).
  - `bundledHarnessDir()` в собранном приложении — `<process.resourcesPath>/harness`
    (`src/main/harness/bundled.ts:17-19`). `extraResources` с Harness стоит в корне
    `electron-builder.yml:18-20`, а не в секции `mac:` — значит, попадёт и в сборку Windows.
  - `claudeExecutablePath()` отдаёт `…/claude-agent-sdk-<platform>-<arch>/claude` без `.exe`
    (`src/main/agent/options.ts:51-54`). На Windows его чинит Ticket 09 (окружение агента).
  - Мост Limits `scripts/statusline-bridge.sh` — `#!/bin/sh`. Без `jq` он ничего не пишет (`:33`),
    папки данных зашиты как `$HOME/Library/Application Support/…` (`:39-40`). На Node его
    переписывает Ticket 08 (пути и папки на Windows). Имя нового файла и то, как не сломать уже
    записанные на Mac команды, — в Итог Ticket-а 08.
- Windows:
  - Без Git Bash у Claude Code нет Bash tool, и hooks с matcher `Bash` молчат. `bash.exe` Git for
    Windows может не быть в PATH. Если стоит WSL, в PATH есть `C:\Windows\System32\bash.exe` — это
    запуск WSL, а не Git Bash. Как worfy находит Git Bash для Session-ов, решает Ticket 09.
  - `powershell.exe` (Windows PowerShell) есть в каждой Windows 10 и 11. `pwsh.exe` есть, только
    если поставлен PowerShell 7. Какую оболочку берёт Terminal, решает Ticket 10 (Terminal на
    PowerShell). `winget install Microsoft.PowerShell` на ПК поставил MSIX: в `Path` — псевдоним
    `WindowsApps\pwsh.exe`, который `fs.existsSync` не видит (evidence Ticket-а 01, разделы 16 и 25).
  - Без `CLAUDE_CODE_GIT_BASH_PATH` Claude Code 2.1.233 на ПК сам нашёл Git Bash, хотя первым
    `bash` в PATH стоит WSL (evidence, разделы 04 и 13).
  - Windows 10 21H2 — build 19044. `os.release()` на Windows отдаёт `10.0.<build>`, у Windows 11
    build от 22000.
  - Идентификаторы winget: `Git.Git`, `OpenJS.NodeJS.LTS`, `GitHub.cli`, `jqlang.jq`,
    `Microsoft.PowerShell`.
  - Node на Windows не запускает `.cmd` и `.bat` через `execFile` и `spawn` без `shell: true`: ошибка
    `EINVAL` (исправление CVE-2024-27980, Node 18.20.2 и 20.12.2). Файл с shebang там не исполняется.
    `git`, `gh`, `node` и `jq` из winget — настоящие `.exe`. Родной установщик Claude Code даёт
    `claude.exe`, а `claude` из npm — это `claude.cmd`.
  - `jq` агенты зовут прямо из skills в Git Bash (`harness/skills/epic-wave/SKILL.md:68`, `:413`,
    `harness/skills/continuous-audit/SKILL.md:125`). Hooks на Node (Ticket 04) `jq` не зовут, а skills
    зовут его и после порта. В Git Bash ПК владельца (Git for Windows 2.45.1) `jq` нет (evidence
    Ticket-а 01, раздел 05). Решение владельца 2026-10-09 (раздел 27): `jq` на Windows не требуется.
  - Экран первого запуска сейчас на Windows (снимок `../evidence/02-pnpm-dev.png`, evidence Ticket-а
    01, раздел 27): «worfy checks this Mac»; `git`, `gh`, `node`, `jq` — Failed «not found on the PATH
    of the login shell» с подсказками `brew install …`, хотя `git`, `gh` и `node` на ПК стоят и есть в
    PATH процесса (раздел 16); «Claude Code in the terminal» — Warning, не найден, хотя
    `%USERPROFILE%\.local\bin\claude.exe` есть.
  - Hooks plugin-а на ПК срабатывают (песочница `claude -p --plugin-dir`, evidence, раздел 13);
    `plugin marketplace add` с путём `C:\…` не проверялся. Contract
    `test/contract/harness-install.test.ts` на ПК — 11 упавших: `step: "marketplace add"`,
    `Claude Code not found at …\stub\claude (ENOENT)` — подменённый `claude` без `.exe` (раздел 17).
- На Windows-ПК владельца старого Harness в `%USERPROFILE%\.claude` нет (на снимке — «Old Harness in
  ~/.claude: none», evidence Ticket-а 01, раздел 27). Форме переноса E3 там нечего
  показать, и `statusLine` записать некому. Тогда Limits из терминала в worfy не приходят.

## Что делаем

1. **Проверки машины на Windows** (Q18, Q24, Q20). В модуле проверок E3 — ветка для `win32`. Список
   и подсказки на Mac не меняются. Проверки получают систему, `os.release()`, архитектуру и ответы
   проб параметром — так test подставляет Windows на любой машине.
   - **Git for Windows.** Git Bash ищет тот же helper, которым Ticket 09 находит его для
     `CLAUDE_CODE_GIT_BASH_PATH`. `bash.exe` из `C:\Windows\System32` не считается. Нет Git Bash —
     `fail`, подсказка `winget install Git.Git`.
   - **`git`, `gh`, `node` ≥ 22, `jq`** — те же проверки E3. Подсказка на Windows —
     `winget install <id>` вместо `brew install`. Окружение — окружение процесса worfy, как его
     собирает Ticket 09, а не login shell.
   - **PowerShell.** Выбор оболочки — тот же, что у Terminal (Ticket 10). Есть `pwsh.exe` — `ok`.
     Есть только `powershell.exe` — `warn` «Terminal uses Windows PowerShell» и подсказка
     `winget install Microsoft.PowerShell`.
   - **Версия Windows.** Build меньше 19044 — `fail` «Windows 10 21H2 or newer is required».
     Архитектура не x64 — `warn`: arm64 придёт позже (Q24), сборку x64 под эмуляцией никто не
     проверял.
   - **`claude --version` из терминала.** На Windows проверка находит и `claude.exe`, и `claude.cmd`
     из npm. `.cmd` запускается так, чтобы Node не отказал с `EINVAL`.
   - Подписи — по-английски (`docs/design/BRIEF.md`). Раздел `## First run` в
     `docs/design/F-SPEC.md` получает строки Windows.
2. **Установщик Harness на Windows.**
   - Источник — `bundledHarnessDir()`, то есть `<папка установки>\resources\harness`. Папку
     установки выбирает Ticket 12 (сборка на Windows). Цель — `harnessHome()\plugin`, то есть
     `%USERPROFILE%\.claude\worfy-harness\plugin`.
   - Бинарь — `claudeExecutablePath()`. После Ticket-а 09 это `claude.exe` из пакета
     `claude-agent-sdk-win32-x64`.
   - Команды — те же, по ADR-0048, с путём Windows. Принимает ли `plugin marketplace add` путь
     `C:\…` или ему нужен `/`, исполнитель проверяет настоящим `claude.exe` в песочнице и пишет в
     Итог.
   - Замена папки plugin. На Windows переименование может вернуть `EPERM` или `EBUSY`: файл держит
     антивирус или другой процесс. Тогда — повтор с паузой, как делает `graceful-fs` на win32. После
     последней попытки — состояние «ошибка» с шагом `copy`, прежняя копия plugin цела.
   - dev-сборка Harness не ставит: правило E3 Ticket 13 не меняется.
3. **Мост Limits в `statusLine` на Windows** (Q19).
   - Команда — `node "<process.resourcesPath>/<файл моста Ticket-а 08>"`. Путь — с `/`, в двойных
     кавычках. Прежняя команда пользователя, если была, — аргументом, как у моста на Mac. Строит
     команду та же функция, что строку `statusLine` формы переноса E3 Ticket 14. На Mac команда —
     та, что оставил Ticket 08.
   - На Windows экран первого запуска получает проверку «Limits from terminal». Она `warn`, если
     `statusLine` в `%USERPROFILE%\.claude\settings.json` не зовёт мост этой сборки. Действие идёт
     через окно подтверждения E3 Ticket 19. В окне — файл, прежняя и новая `statusLine.command`.
     Запись — той же функцией, что у формы переноса. Меняется только ключ `statusLine`.
   - На Mac этой проверки нет. Предлагать мост на Mac пользователю без `statusLine` владелец не
     решал (E3 Ticket 15) — вопрос в Итог.
   - В какой оболочке Claude Code на Windows исполняет `statusLine.command`, не установлено. Путь с
     `/` в двойных кавычках `node` понимает и в Git Bash, и в cmd.exe, и в PowerShell. Как
     экранировать аргумент, исполнитель проверяет в этой оболочке и пишет в Итог.
4. **jq — `warn` на Windows** (решение владельца 2026-10-09, evidence Ticket-а 01, раздел 27). В Git
   Bash `jq` нет (раздел 05), а требовать его на Windows владелец не стал. Нет `jq` на `win32` —
   `warn` с подсказкой `winget install jqlang.jq` и строкой, что без него не работают блоки skills с
   `jq`; Install Harness это не останавливает. Строку убирают Ticket-ы 04 и 05, когда hooks и скрипты
   `bin` перейдут на Node, — или оставляют `warn`, пока `jq` зовут skills (решение — их Итог). На
   `darwin` — прежний `fail`.

**Не входит:** qmd (Ticket 15); приёмка установщика и первого запуска на ПК владельца (Ticket 16); Git Bash для Session-ов и
`claude.exe` (Ticket 09); Terminal на PowerShell (Ticket 10); установщик NSIS и Stable copy
(Ticket 12); сам мост на Node (Ticket 08); test-ы E3 с подменённым `claude` на Windows (Ticket 14:
тот же способ подмены, что для `gh`).

## Готово, когда

- [x] Unit `test/unit/first-run-windows.test.ts`, система `win32`, ответы проб подставлены: нет Git Bash — `fail` и `winget install Git.Git`; есть только `C:\Windows\System32\bash.exe` — `fail`; `node` v20 — `fail` и `winget install OpenJS.NodeJS.LTS`; нет `gh` — `winget install GitHub.cli`; нет `jq` — `warn` (не `fail`) и `winget install jqlang.jq`; нет `pwsh.exe`, есть `powershell.exe` — `warn` и `winget install Microsoft.PowerShell`; `os.release()` `10.0.19043` — `fail`, `10.0.19044` и `10.0.22631` — `ok`; архитектура `arm64` — `warn`. Test идёт на любой системе, в CI на Linux тоже.
- [x] Тот же test с системой `darwin`: строки и подсказки — как до этого Ticket-а (`brew install …`), строк Windows нет.
- [x] Unit: команда `statusLine` для `win32` — `node "<resources>/<файл моста>"` с `/` и прежней командой аргументом; для `darwin` — прежняя.
- [x] Contract `test/contract/harness-install.test.ts`: случай с настоящим встроенным бинарём идёт и на Windows. В песочнице (`CLAUDE_CONFIG_DIR` во временной папке) `claude.exe plugin list --json` показывает `worfy` включённым и с версией сборки; повторная установка — код 0; ключи `settings.json` песочницы на месте.
- [ ] На Windows-ПК владельца после установки неподписанного NSIS (Ticket 12) экран первого запуска: все строки `ok`, `warn` — только у PowerShell, архитектуры или `jq`. Снимок — `../evidence/13-первый-запуск.png`.
- [ ] Там же после Install: `claude plugin list --json` в PowerShell — `worfy` включён, версия равна версии сборки. Та же версия — в `%USERPROFILE%\.claude\worfy-harness\plugin\.claude-plugin\plugin.json`.
- [ ] Hooks срабатывают: `claude -p "ok" --output-format stream-json --verbose` в PowerShell в клоне worfy. В `system/init` есть plugin `worfy`, есть `hook_response` hook-а `SessionStart` с `exit_code` 0. Вывод (без токенов) — в Итог.
- [ ] Limits. Отказ в окне подтверждения — хеш `settings.json` до и после совпадает. После «Confirm» `claude` в Terminal Node отвечает один раз; в папке данных worfy (путь — Ticket 08) появляется `statusline-limits.json`; Limits в worfy показывают проценты. Снимок — `../evidence/13-limits.png`.
- [ ] `GATE_SCOPE=all` gate full (команда Gate — какой её оставил Ticket 03) — код 0 на Mac (по правилу needs-mac-gate: проверяет и вливает Session на Mac) и на ПК владельца.

## Тесты

Сначала падающий test — `test/unit/first-run-windows.test.ts`: с системой `win32` в списке проверок
нет строки Git Bash, test красный. В Итог — как он падал.

- `test/unit/first-run-windows.test.ts` — новый: строки и подсказки Windows; Mac без изменений.
- `test/contract/first-run-checks.test.ts` — список проверок на Mac прежний.
- `test/contract/harness-install.test.ts` — случай с настоящим бинарём и на Windows.
- `test/contract/harness-migrate.test.ts` — команда `statusLine` на `win32`, если функция осталась
  в модуле формы переноса.

Настоящий `%USERPROFILE%\.claude` test-ы не трогают: только песочница, как в E3 Ticket 13.
Проверку на настоящей машине делают пункты «Готово, когда» на ПК владельца.

## Где в коде

- `src/main/first-run/checks.ts`
- `src/main/first-run/actions.ts`
- `src/shared/ipc/first-run.ts`
- `src/main/harness/install.ts`
- `src/main/harness/migrate/plan.ts`
- `src/main/harness/migrate/apply.ts`
- `docs/design/F-SPEC.md`
- `test/unit/first-run-windows.test.ts` — новый
- `test/contract/first-run-checks.test.ts`
- `test/contract/harness-install.test.ts`
- `test/contract/harness-migrate.test.ts`
- `src/main/harness/status-line.ts` — новый: команда `statusLine` моста Limits для обеих систем (добавлен исполнителем)
- `src/main/ipc/first-run.ts`, `src/main/ipc/harness-migration.ts` — проводка моста этой сборки (добавлены исполнителем)
- `src/renderer/shell/FirstRunChecks.tsx` (группа `Windows`), `src/renderer/shell/FirstRun.tsx` («this PC» вместо «this Mac» не на Mac) — добавлены исполнителем
- `src/main/agent/options.ts` — `bundledClaudeBinary` в dev-run на Windows отдаёт `claude.exe` (добавлен исполнителем)

Пути — из планов E3; на main `76f7ff8` и `8cabc65` все эти файлы, кроме новых test-ов, есть (evidence Ticket-а
01, раздел 24).

Только чтение: `src/main/agent/env.ts` (поиск Git Bash, Ticket 09), `src/main/agent/options.ts`
(`claudeExecutablePath`, Ticket 09; исполнитель всё же поправил в нём `bundledClaudeBinary` — см. список выше и Итог), `src/main/terminal/pty.ts` (выбор PowerShell, Ticket 10),
`src/main/harness/bundled.ts`, `src/main/storage/paths.ts`, файл моста Limits Ticket-а 08.
`src/renderer/shell/FirstRun.tsx` меняется, только если общий код экрана не рисует новую проверку;
тогда исполнитель добавляет файл в этот список. Окно ошибки старта (`src/main/startup-failure.ts`)
от системы не зависит, этот Ticket его не меняет.

`test/contract/harness-install.test.ts` правит и Ticket 14 (подменённый `claude` на Windows). Они не
блокируют друг друга; в одну Wave не попадут, второй делает rebase. Ticket 15 (qmd) идёт после этого
Ticket-а и правит `src/main/first-run/checks.ts` вслед за ним.

## Итог

Ветка `worfy-windows/13-first-run` от main `384cfb3`; код и прогоны — Session Claude Code на Windows-ПК владельца
(Windows 11 Pro 10.0.26200, Node 24.21, x64). Push и PR — за orchestrator-ом.

- **Проверки на Windows** (`src/main/first-run/checks.ts`). `CheckDeps` получил `system` (`platform`,
  `release` = `os.release()`, `arch`), `probes` (`run` — запуск tool-а, `exists` — есть ли файл) и
  `limitsBridge`; по умолчанию — эта машина. Строки только для `win32`: «Limits from terminal» (группа
  Claude Code), группа `Windows` — «Windows version» (build < 19044 — `fail` «Windows 10 21H2 or newer is
  required»), «Architecture» (не x64 — `warn`; архитектура машины, а не процесса: `PROCESSOR_ARCHITEW6432`, иначе
  `PROCESSOR_ARCHITECTURE` окружения Session, которое Ticket 09 берёт из реестра HKLM. Предел: при `from:
  'fallback'` (реестр не прочитан) переменная — из процесса worfy, и сборка x64 под эмуляцией на arm64 видит
  `AMD64`; `os.machine()` не помогает — libuv берёт архитектуру процесса), «PowerShell» (`terminalShell` Ticket-а 10 с той же проверкой файла, что у Terminal, —
  `fileOrAlias` из `env.ts`, видит alias MSIX в WindowsApps, которого не видит `existsSync`; нет `pwsh.exe` —
  `warn` «Terminal uses Windows PowerShell» и `winget install Microsoft.PowerShell`); «Git Bash» после git
  (как у Session: `CLAUDE_CODE_GIT_BASH_PATH`, если он задан, иначе `findGitBash` Ticket-а 09; переменная с файлом под
  `%SystemRoot%` — например `System32\bash.exe`, запуск WSL — или с несуществующим файлом — `fail`; нет Git
  Bash — `fail` и `winget install Git.Git`).
  Подсказки на Windows — `winget install <id>` (`WINGET_IDS`), «not found on the PATH» вместо «… of the login
  shell»: окружение — то, что `agentEnv()` на Windows уже собирает по Ticket-у 09 (реестр, не login shell).
  `jq` на `win32` — `warn` с `winget install jqlang.jq` и строкой, что без него не работают шаги skills с
  `jq`; на `darwin` — прежний `fail`. Список и подсказки Mac не менялись.
- **`claude --version` на Windows**: `toolStart`/`windowsProgram` идут по `PATH` папка за папкой, в каждой —
  `.exe`, `.bat`, `.cmd` в порядке `PATHEXT`, как командная строка; `.cmd`/`.bat` идут через
  `%SystemRoot%\System32\cmd.exe` (`shell`), без `EINVAL`. cmd.exe раскрывает `%NAME%` в пути — папка с `%`
  в имени будет прочитана как другая (записано в коде). По timeout проверка отвечает сразу, не ждёт закрытия
  pipe-ов (их держит node.exe под cmd.exe), и гасит дерево: `taskkill /pid <pid> /T /F` на Windows, `SIGKILL`
  на остальных. Unit-случай с настоящим `claude.cmd` на ПК прошёл.
- **Установщик** (`src/main/harness/install.ts`): переименования и удаления папок plugin — через
  `retriedOnWindows`: на `win32` при `EPERM`/`EBUSY`/`EACCES` (у удаления ещё `ENOTEMPTY`) повтор с паузой 0,
  10 … 100 мс до 60 с, как `graceful-fs`. Старую папку не убрать в сторону — `error` на шаге `copy`, старая на
  месте. Новую копию не поставить на место — сначала возвращается старая (как на main: `plugin/` нет как можно
  меньше; не дольше `ROLLBACK_RETRY_MS` = 10 с), потом удаляется staging (тоже не дольше 10 с: остаток уберёт
  следующая установка); худший случай — 60 + 10 + 10 ≈ 80 с; `error` на шаге `copy` с первой ошибкой; если и возврат не удался,
  сообщение говорит об этом, `plugin/` нет, прежняя копия лежит в `.plugin-old-*`, и следующая установка ставит
  её на место первой (`removeLeftovers`). Старую папку не удалить после замены — установка успешна, папка
  остаётся с предупреждением в лог и уходит при следующей установке. `removeLeftovers` папку, которую не
  удалить или не вернуть, пропускает с предупреждением и установку не роняет. Источник, цель и бинарь — прежние `bundledHarnessDir()`,
  `harnessHome()/plugin`, `claudeExecutablePath()`. Попутно: `bundledClaudeBinary` в dev-run на Windows
  отдавал `…\claude` без `.exe` — статус Harness в `pnpm dev` падал бы с ENOENT; теперь `claude.exe`.
- **`statusLine`** — новый `src/main/harness/status-line.ts`: `bridgeFile` (`<resources>/statusline-bridge.mjs`
  на Windows, `statusline-bridge.sh` на Mac), `bridgeCommand`/`withBridge` (Windows —
  `node 'C:/…/statusline-bridge.mjs' '<прежняя команда>'`, Mac — прежняя строка формы переноса), `bridgeOf`
  (обе формы считаются мостом, путь и в двойных кавычках прежних сборок). Форма переноса (`migrate/plan.ts`) строит строку той же функцией; запись —
  общая `withStatusLineCommand` из `src/main/harness/status-line.ts`, её зовут `writeSettings` формы переноса и
  новый `writeStatusLine` в `migrate/apply.ts`. Строка формы переноса на Mac — как на main
  (`otherBuildBridge` в `migrate/plan.ts`): только вход `.sh`, в dev-сборке с относительным путём — строки нет,
  форма `node "…/statusline-bridge.mjs"` на Mac не считается; на Windows — обе формы. Проверка
  «Limits from terminal» на Windows: `ok`, когда `statusLine.command` зовёт мост этой сборки; иначе `warn` с
  кнопкой «Set up…» (действие `limits-bridge`): окно подтверждения с файлом, прежней и новой командой, запись
  только ключа `statusLine`; файл, изменённый после окна, — отказ. В dev-сборке — `warn` без кнопки.
- **Аргумент и путь моста в `statusLine` на Windows** — POSIX single quotes (`'…'\''…'`, `shellWord`): в
  двойных кавычках Git Bash раскрыл бы `$`, `$(…)` и backtick в папке установки. По Итогу Ticket-а 08 Claude Code
  на Windows исполняет `statusLine` через Git Bash. Живой прогон `statusLine` в интерактивной Session не
  делался (нужно окно Claude Code): если оболочка окажется cmd.exe, одинарные кавычки там не кавычки —
  проверяет пункт Limits на ПК владельца.
- **`plugin marketplace add` с путём `C:\…`**: настоящий `claude.exe` из `claude-agent-sdk-win32-x64` в
  песочнице (`CLAUDE_CONFIG_DIR`, `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP` — во временной
  папке, `PATH` — только System32, прокси на закрытый порт) принял путь с `\`; `plugin list --json` —
  `worfy` включён, версия сборки; повтор команд — код 0; ключи `settings.json` песочницы на месте. Файлы
  настоящего `%USERPROFILE%\.claude` (`settings.json`, `plugins/known_marketplaces.json`,
  `plugins/installed_plugins.json`) до и после прогона — те же mtime и hash.
- **Как падал первый test** (`test/unit/first-run-windows.test.ts` на коде main): без
  `src/main/harness/status-line.ts` файл не загрузился (`Cannot find module '/src/main/harness/status-line'`, no
  tests). С одним этим модулем, остальной код — main: 22 из 26 красные, например
  `Error: no check git-bash: claude-login, claude-version, git, gh, node, jq, gh-auth, …` — строки Git Bash в
  списке нет.
- **Прогоны на ПК** (`node scripts/vitest-electron.mjs`, `gh` убран из `PATH`):
  - `test/unit/first-run-windows.test.ts` — exit 0, 34 passed (вместе с настоящим `claude.cmd`);
  - `test/contract/harness-install.test.ts` — exit 0, 54 passed, 0 skipped (настоящий `claude.exe`, повторы
    переименования, неудаляемая старая копия и остатки, двойной отказ — замена и возврат);
  - mutants (по одному, файлы возвращены байт в байт): без проверки `%SystemRoot%` в `findGitBash`
    (`env.ts`) — 1 красный; `jq --version` с ошибкой на `win32` как `fail` — 1 красный;
  - `test/unit/agent-env.test.ts` + `e2e-no-spawn-on-load` — exit 0, 112 passed, 4 skipped;
  - `test/contract/first-run-checks.test.ts` + `test/contract/harness-migrate.test.ts` — exit 1, 38 failed /
    47 passed / 11 skipped; на коде main на этом ПК — те же 38 failed, список совпадает строка в строку.
    Причины не этого Ticket-а: stand-in-ы `first-run-tools` — `#!/bin/sh` (22), в fixture
    `claude-home-legacy` `__SANDBOX__` заменяется путём с `\` внутри JSON и `$HOME/…` в командах (16) —
    Ticket 14. В `first-run-checks.test.ts` `deps()` теперь передаёт `system: darwin`: иначе на Windows-хосте
    два случая Mac (`brew install jq`, git/gh) стали бы `winget`;
  - `test/unit/e2e-no-spawn-on-load.test.ts`, `agent-executable`, `settings-health`, `palette-commands`,
    `connect-project`, `harness-migration-form`, `harness-migrate-renamed-hooks` — exit 0, 152 passed;
  - `pnpm lint` — exit 0; `pnpm typecheck` — exit 0. Gate не запускался: на ПК нет registry Harness (exit 3
    ожидаем), gate full — на Mac.
- **Раунд ревью 2** (ревью c3839d2 на Mac, PR #479). Изменения: при отказе новой копии старая
  возвращается в `plugin/` до удаления staging (порядок main); удаление staging на всех путях отказа — не
  дольше `ROLLBACK_RETRY_MS`, худший случай ≈ 80 с вместо ≈ 130 с; неиспользуемый `renameRetried` удалён;
  строка PowerShell ищет `pwsh.exe` через `fileOrAlias` (alias MSIX); таймер `runTool` вынесен в `killTool`
  (тесты подменяют kill); путь моста на Windows — в одинарных кавычках (`shellWord`); `writeAtomically`
  удаляет временный файл, если rename не удался. Новые tests: порядок отката, старая папка не уходит в
  сторону, первая установка с отказом, единственная копия в `.plugin-old-*` не удаляется `removeLeftovers`,
  граница ожидания (часы подменены), settings.json изменён во время окна, действие в состоянии
  `unavailable`, нет файла моста, мост другой сборки, новый `statusLine` с `type: 'command'`, `$(…)` в пути,
  alias `pwsh.exe` на этом ПК, папка `pwsh.exe`, зависший tool (ответ по timeout, потом kill дерева
  cmd.exe → node.exe), архитектура не зависит от хоста (x86 → ia32). Mutants — 16 из 16 красные (по одному,
  файлы возвращены байт в байт), среди них все выжившие из ревью.
  Прогоны: `first-run-windows` + `harness-install` — exit 0, 103 passed; `first-run-checks` +
  `harness-migrate` — exit 1, 38 failed / 47 passed / 11 skipped, список совпадает с main строка в строку;
  `agent-env` + `e2e-no-spawn-on-load` — exit 0, 112 passed, 4 skipped; `pnpm lint` — 0; `pnpm typecheck` — 0.
- **Раунд ревью 3** (ревью ede2de8 на Mac). `splitCommand` (`status-line.ts`) читает первое слово как POSIX
  shell: части `'…'`, `"…"` (там `\` экранирует только `$`, backtick, `"`, `\`, перевод строки) и текст
  без кавычек (там `\` экранирует пробел, кавычку, `\`, `$`, backtick — путь Windows без кавычек читается как
  написан), склеенные в одно слово; незакрытая кавычка — текст до пробела, как прежде. Раньше путь моста с
  `'` (`C:\Users\O'Brien`, `/Users/o'brien`) после `shellWord` (`'…'\''…'`) обрывался на второй кавычке:
  `bridgeOf` давал null, строка Limits оставалась `warn`, и каждый Confirm заворачивал мост в мост ещё раз.
  Новые tests (сначала красные на ede2de8: 4 failed / 44 passed): `'` в пути для формы Windows и Mac, round
  trip (команда собрана, `bridgeOf` возвращает мост и прежнюю команду без изменений, для пяти разных
  команд), второй Confirm находит мост и не пишет файл, сам `splitCommand`. В test зависшего tool-а
  `afterEach` гасит `hang.js` по pid из его файла, только если в командной строке этого pid — `hang.js`
  из папки этого test-а, и удаляет файл. Mutants `status-line.ts` — 9 из 9 красные (5 новых в
  `splitCommand` и 4 прежних). Прогоны (тяжёлые — под общим lock `heavy.lock`): `first-run-windows` —
  exit 0, 48 passed; `harness-install` — exit 0, 59 passed; `harness-migrate` + `first-run-checks` — exit 1,
  38 failed / 47 passed / 11 skipped, список совпадает с main; `e2e-no-spawn-on-load` — exit 0, 48 passed;
  `pnpm lint` — 0; `pnpm typecheck` — 0.
- **Ждут ПК владельца** (не отмечены): установка NSIS и экран первого запуска со снимком, `claude plugin list`
  в настоящем `%USERPROFILE%`, hooks в настоящей Session, Limits с настоящим `settings.json` (там же — в какой
  оболочке Claude Code исполняет `statusLine`). Пункт gate — Mac (needs-mac-gate).
- **Ревьюеру PR на Mac**: `test/contract/first-run-checks.test.ts`, `harness-migrate.test.ts` и
  `harness-install.test.ts` (случай с настоящим `claude` на macOS) зелёные на Mac; экран First run на Mac —
  тот же список, подзаголовок «this Mac»; строка формы переноса на Mac байт в байт прежняя.
- **Вопрос владельцу** (E3 Ticket 15, не решён): предлагать мост Limits на Mac пользователю без `statusLine`?
  Этот Ticket добавил проверку только на Windows.
