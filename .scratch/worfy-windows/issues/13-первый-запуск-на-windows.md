# 13 — Первый запуск на Windows: проверки машины и установщик Harness из E3

Type: task
Status: open
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
    Ticket-а 01, раздел 05). В «Готово, когда» Epic-а чистая Windows названа «с Git for Windows,
    node и gh», без `jq` — вопрос владельцу задан в отчёте PR Ticket-а 01.
  - Hooks plugin-а на ПК срабатывают (песочница `claude -p --plugin-dir`, evidence, раздел 13);
    `plugin marketplace add` с путём `C:\…` не проверялся. Contract
    `test/contract/harness-install.test.ts` на ПК — 11 упавших: `step: "marketplace add"`,
    `Claude Code not found at …\stub\claude (ENOENT)` — подменённый `claude` без `.exe` (раздел 17).
- На чистой Windows старого Harness в `%USERPROFILE%\.claude` нет. Форме переноса E3 там нечего
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
4. **jq.** Проверка `jq` на Windows остаётся: его зовут skills. В Git Bash `jq` нет (evidence
   Ticket-а 01, раздел 05), и на чистой Windows экран покажет `fail` с `winget install jqlang.jq`.
   Это расходится с «Готово, когда» Epic-а (там только Git for Windows, node и gh). Вопрос владельцу
   задан в отчёте PR Ticket-а 01; его ответ — в Итог. Нет ответа к началу Ticket-а — вопрос в Итог.

**Не входит:** qmd (Ticket 15); проверка на чистой машине (Ticket 16); Git Bash для Session-ов и
`claude.exe` (Ticket 09); Terminal на PowerShell (Ticket 10); установщик NSIS и Stable copy
(Ticket 12); сам мост на Node (Ticket 08); test-ы E3 с подменённым `claude` на Windows (Ticket 14:
тот же способ подмены, что для `gh`).

## Готово, когда

- [ ] Unit `test/unit/first-run-windows.test.ts`, система `win32`, ответы проб подставлены: нет Git Bash — `fail` и `winget install Git.Git`; есть только `C:\Windows\System32\bash.exe` — `fail`; `node` v20 — `fail` и `winget install OpenJS.NodeJS.LTS`; нет `gh` — `winget install GitHub.cli`; нет `jq` — `winget install jqlang.jq`; нет `pwsh.exe`, есть `powershell.exe` — `warn` и `winget install Microsoft.PowerShell`; `os.release()` `10.0.19043` — `fail`, `10.0.19044` и `10.0.22631` — `ok`; архитектура `arm64` — `warn`. Test идёт на любой системе, в CI на Linux тоже.
- [ ] Тот же test с системой `darwin`: строки и подсказки — как до этого Ticket-а (`brew install …`), строк Windows нет.
- [ ] Unit: команда `statusLine` для `win32` — `node "<resources>/<файл моста>"` с `/` и прежней командой аргументом; для `darwin` — прежняя.
- [ ] Contract `test/contract/harness-install.test.ts`: случай с настоящим встроенным бинарём идёт и на Windows. В песочнице (`CLAUDE_CONFIG_DIR` во временной папке) `claude.exe plugin list --json` показывает `worfy` включённым и с версией сборки; повторная установка — код 0; ключи `settings.json` песочницы на месте.
- [ ] На Windows-ПК владельца после установки неподписанного NSIS (Ticket 12) экран первого запуска: все строки `ok`, `warn` — только у PowerShell или архитектуры. Снимок — `../evidence/13-первый-запуск.png`.
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

Пути — из планов E3; на main `76f7ff8` и `8cabc65` все эти файлы, кроме новых test-ов, есть (evidence Ticket-а
01, раздел 24).

Только чтение: `src/main/agent/env.ts` (поиск Git Bash, Ticket 09), `src/main/agent/options.ts`
(`claudeExecutablePath`, Ticket 09), `src/main/terminal/pty.ts` (выбор PowerShell, Ticket 10),
`src/main/harness/bundled.ts`, `src/main/storage/paths.ts`, файл моста Limits Ticket-а 08.
`src/renderer/shell/FirstRun.tsx` меняется, только если общий код экрана не рисует новую проверку;
тогда исполнитель добавляет файл в этот список. Окно ошибки старта (`src/main/startup-failure.ts`)
от системы не зависит, этот Ticket его не меняет.

`test/contract/harness-install.test.ts` правит и Ticket 14 (подменённый `claude` на Windows). Они не
блокируют друг друга; в одну Wave не попадут, второй делает rebase. Ticket 15 (qmd) идёт после этого
Ticket-а и правит `src/main/first-run/checks.ts` вслед за ним.

## Итог

Заполняется при закрытии.
