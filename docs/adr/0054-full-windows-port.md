# 0054 — Полный порт worfy под Windows: Windows 10 21H2+ и 11 x64, Git for Windows обязателен, Terminal на PowerShell, неподписанный установщик NSIS до E4
Дата: 2026-10-07. Статус: принят.

**Контекст.** Сегодня worfy — приложение только для macOS (ADR-0004, первая строка `CONTEXT.md`).
2026-10-07 владелец попросил порт под Windows: работа продолжается на Mac, интерфейс открывается на
Windows, пока только по локальной сети. Session проектирования «Несколько машин и порт под Windows»
(2026-10-07, вопросы Q1–Q25) разделила запрос на два Epic-а. Работу с Project-ом другой машины по
LAN решают ADR-0052 (Machine и связь машин) и ADR-0053 (несколько экранов на одном Project); этот ADR —
о самом worfy на Windows. Решения владельца — по вопросам Q1, Q18, Q20–Q22 и Q24.

Бриф фактов о порте (2026-10-07). Он собран из трёх отчётов: платформа, Harness, worfy. Ссылки на
код перечитаны в репозитории; на Windows ничего не запускалось.

- **Claude Code** работает на Windows 10 1809+ и Server 2019+, x64 и ARM64. По документации
  (setup) Git for Windows необязателен. Но без Git Bash не регистрируется Bash tool, молчат hooks с
  matcher `Bash` и не работает Monitor tool (документация hooks). Hooks в shell form идут в Git
  Bash. Конфигурация лежит в `%USERPROFILE%\.claude`, учётные данные — в `.credentials.json`, без
  Keychain.
- **Agent SDK 0.3.289** несёт Windows-бинарь в optional-пакетах `claude-agent-sdk-win32-x64` и
  `-win32-arm64`: один `claude.exe`, около 250 МБ. pnpm ставит пакет только своей платформы, а
  `supportedArchitectures` в репозитории не задан. Поэтому сборка под Windows на Mac `claude.exe`
  не положит.
- **node-pty 1.1.0** несёт prebuilds `win32-x64` и `win32-arm64`. ConPTY включается со сборки
  Windows 18309, ниже работает winpty (`node_modules/node-pty/typings/node-pty.d.ts:91`). Оболочка
  по умолчанию — `cmd.exe`. `postinstall` (`electron-rebuild --only node-pty`, `package.json:20`) на
  Windows компилирует node-pty из исходников и требует Visual Studio Build Tools и Python.
- **Electron 44.** Уведомлениям на Windows нужен `app.setAppUserModelId` до первого окна; в `src/`
  такого вызова нет.
- **Места в worfy, завязанные на macOS:**
  - папка данных `~/Library/Application Support` (`src/main/storage/paths.ts:33`);
  - Terminal (Node с shell-сессией пользователя) запускает `$SHELL` или `/bin/zsh` с `-l`
    (`src/main/terminal/pty.ts:227-229`) и шлёт сигналы группе процессов (`pty.ts:284-290`);
  - окружение агента — `$SHELL -ilc` и POSIX `SYSTEM_PATH` (`src/main/agent/env.ts:16-17`,
    ADR-0007); `ps` (`src/main/claude-home/registry.ts:116`);
  - пути через `startsWith('/')` — 9 мест в 6 файлах;
  - окно `hiddenInset` и `vibrancy` (`src/main/window.ts:77-79`), меню `appMenu` только на darwin
    (`src/main/menu.ts:13`);
  - хоткеи на `metaKey` — 12 мест в `src`, `Meta` в e2e — 51 вхождение в 12 файлах;
  - упаковка `--mac dir` (`package.json:12`) и `electronDist` с Electron для macOS
    (`electron-builder.yml:23`); секции `win:` нет.
- **Подпись.** Установщик NSIS собирается и на Mac, без Wine. Без подписи SmartScreen показывает
  «Windows protected your PC» → More info → Run anyway. Smart App Control на Windows 11
  неподписанное блокирует. EV-сертификат SmartScreen больше не обходит. Artifact Signing от
  Microsoft стоит от $9.99 в месяц (MS Learn, SmartScreen reputation).
- **winget** знает `Git.Git`, `OpenJS.NodeJS.LTS`, `GitHub.cli`, `jqlang.jq`,
  `Microsoft.PowerShell`, `Anthropic.ClaudeCode`.
- **Объём** — 13–15 Ticket-ов (Ticket — одна Session, один PR) и ещё 1–2 на qmd. Самый высокий риск
  — Harness, окружение агента и node-pty.
- **Не установлено:**
  - кодирует ли Claude Code на Windows путь `C:\a\b` в имя каталога так же, как
    `src/main/claude-home/registry.ts:44`;
  - нужна ли пересборка node-pty, если его prebuilds собраны на N-API;
  - работает ли qmd на Windows;
  - есть ли `longPathAware` у `electron.exe`: лимит пути в 260 символов под угрозой из-за
    `.claude/worktrees/…/node_modules/.pnpm`;
  - правда ли `core.autocrlf=true` по умолчанию в Git for Windows (данные из вторичных источников;
    что с этим делать — ADR-0055).

**Решение.**

1. **Полный порт (Q1).** worfy на Windows — то же приложение, что на Mac: Project-ы, Canvas,
   Session-ы и их Subagent-ы, Terminal, Gate, `epic-status`, Autopilot. Агенты работают на самой
   Windows-машине, и пользователь без Mac работает только на Windows. Windows-ПК с worfy — это
   Machine (ADR-0052). Project-ы на нём — его Project-ы; один репозиторий на Mac и на Windows — два
   разных Project-а (Q9).
2. **Платформа (Q24)** — Windows 10 21H2 и новее и Windows 11, только x64. 21H2 — сборка 19044,
   выше порога ConPTY (18309), поэтому ветки winpty в worfy нет. arm64 — позже; пакеты SDK и
   node-pty под него уже есть.
3. **Git for Windows обязателен (Q18).** Первый запуск проверяет его так же, как проверяет git, gh и
   node на Mac (ADR-0019; экран первого запуска — Ticket 19 Epic-а E3 `worfy-harness`). Если Git
   for Windows нет, worfy показывает команду `winget install Git.Git`. Сам worfy его не ставит — как
   и node на Mac (ADR-0043, пункт 2). node ≥ 22 на Windows нужен по той же причине, что на Mac:
   скриптам Harness и qmd (ADR-0043).
4. **Terminal — PowerShell (Q20).** Terminal запускает `pwsh` (PowerShell 7), если он установлен,
   иначе Windows PowerShell (`powershell.exe`). Git Bash — выбор в настройках. `cmd.exe`, который
   node-pty берёт по умолчанию, не используется. Bash tool агентов от этой настройки не зависит:
   Claude Code на Windows всегда работает через Git Bash.
5. **Установщик — неподписанный NSIS (Q22).** Установщик собирает Session на Windows-ПК владельца:
   там pnpm сам ставит Windows-пакеты SDK (`claude.exe`) и node-pty. Подпись — в Epic-е E4 («Для
   других людей»: подпись, нотаризация, внешние пользователи), как и на Mac (ADR-0019). Оговорка:
   если на машине, где ставят worfy, включён Smart App Control, неподписанный установщик не
   запустится. Тогда вопрос подписи встаёт сразу, а не в E4.
6. **qmd на Windows — последний Ticket порта (Q21).** До него агенты на Windows ищут grep-ом по
   `qmd.fallback_grep` Profile-а — это запасной путь из ADR-0043, пункт 4. Если qmd на Windows не
   заработает, grep остаётся на Windows явным запасным путём, а не молчаливой заменой. Как это
   видно пользователю и агентам, решает тот же Ticket.
7. **Скрипты Harness — на Node**, чтобы одни и те же скрипты работали на обеих системах. Это
   решение — ADR-0055.
8. **Порядок.** Epic `worfy-windows` («Windows-порт») начинается после закрытия E3 и идёт
   параллельно с Epic-ом `worfy-link` («Linked machines»). Его ведёт Session на Windows-ПК
   владельца. Её первый Ticket проверяет факты брифа на живой Windows и правит Ticket-ы порта. Чем
   проверяется Windows и как две Session-и делят репозиторий — ADR-0056. Epic E4 — после обоих.

**Что меняется в прежних ADR.**

- ADR-0004 (стек: Electron, TypeScript, React, React Flow, Agent SDK): «Electron-приложение для
  macOS» становится «для macOS и Windows»; стек тот же. Первая строка `CONTEXT.md`
  («macOS-приложение для одного пользователя») тоже перестаёт быть верной.
- ADR-0007 (окружение Claude Code — интерактивный login shell пользователя, `$SHELL -ilc`): на
  Windows `$SHELL` нет. Откуда брать окружение агента на Windows, решает Ticket порта «окружение
  агента». На Mac ADR-0007 в силе.
- ADR-0023 (раздельные папки данных dev-запуска и packaged-сборки): правило действует и на Windows.
  Путь `~/Library/Application Support/…` — только для macOS; путь на Windows выбирает Ticket порта
  (бриф предлагает `app.getPath('userData')` из Electron).
- ADR-0040 (доставка Harness в `~/.claude/worfy-harness/`): в силе. На Windows `~/.claude` — это
  `%USERPROFILE%\.claude`, куда смотрит Claude Code.

**Последствия.**

- Epic `worfy-windows` — около 13–15 Ticket-ов: пути и данные; окружение агента, Terminal и
  процессы; запуск Harness и мост Limits (`scripts/statusline-bridge.sh` тоже держит путь
  `~/Library/Application Support`); окно, меню, хоткеи и `AppUserModelId`; упаковка; test-ы
  (5 test-ов с `skipIf(platform !== 'darwin')`, e2e ищет `dist/mac*/worfy.app`).
- Сборка Windows-установщика на Mac без правок не работает: нужен `supportedArchitectures` для pnpm
  и своя `electronDist` для `--win`. Пока установщик собирает только Windows-ПК владельца.
- Сборке из исходников на Windows, возможно, понадобятся Visual Studio Build Tools и Python
  (`postinstall` пересобирает node-pty). Нужна ли пересборка при готовых prebuilds, проверяет
  Ticket 01 Epic-а `worfy-windows`.
- Каждая новая неподписанная версия встречает пользователя окном SmartScreen. Внешним
  пользователям Windows-сборка до E4 не отдаётся.
- Autopilot над самим worfy идёт только из Stable copy (`~/Applications/worfy-stable.app`). Её
  ставит `scripts/install-stable.sh`, который знает только `.app`. Чем будет Stable copy на
  Windows, решает Ticket упаковки; без неё приёмочная Wave Autopilot на Windows не пройдёт.
- На Windows Terminal и Bash tool агента — разные оболочки: PowerShell и Git Bash. Команда из
  ответа агента, вставленная в Terminal, может там не сработать.
- Не установленные факты — кодирование пути `C:\…`, лимит пути в 260 символов для worktree с
  `node_modules`, пересборка node-pty, qmd — проверяет Ticket 01 Epic-а `worfy-windows`. Если факт
  разойдётся с брифом, Ticket-ы порта правятся до начала работы.

## Considered Options

- **Полный порт: worfy и агенты на Windows** (выбрано, Q1).
- **Браузерный клиент: worfy на Mac раздаёт UI по HTTP, на Windows его открывают в браузере.**
  Отвергнуто владельцем (Q1): агенты остаются на Mac, и пользователь без Mac работать не может.
  Вдобавок по брифу о remote UI в браузере нет схемы `worfy-card://` для Card, а по `http://` в LAN
  нет secure context, без которого нет `crypto.randomUUID` (им renderer создаёт Node).
- **Тонкий клиент: Electron на Windows только показывает worfy с Mac.** Отвергнуто владельцем (Q1)
  по той же причине: агенты и Project-ы остаются только на Mac. Сценарий «работа идёт на Mac,
  экран — на Windows» закрывают Linked machines (ADR-0052, ADR-0053) поверх полного порта.
- **WSL: worfy или агенты в Linux внутри Windows.** Отвергнуто: агенты работали бы в Linux, а не на
  Windows (Q1), пользователю нужен WSL, а worfy — Linux-сборка, которой нет. Claude Code на Windows
  и так работает нативно, через Git Bash.
- **Windows 10 1809+, как у Claude Code.** Отвергнуто (Q24): сборки ниже 18309 получают winpty
  вместо ConPTY — вторая ветка Terminal ради старых систем.
- **arm64 сразу.** Отложено владельцем (Q24).
- **Git for Windows необязателен, как в документации Claude Code.** Отвергнуто (Q18): без Git Bash у
  агента нет Bash tool, а hooks с matcher `Bash` молчат.
- **Terminal на Git Bash или `cmd.exe` по умолчанию.** Отвергнуто (Q20): Windows PowerShell есть в
  каждой Windows 10 и 11, `pwsh` — его новая версия. Git Bash остаётся выбором в настройках.
- **Подпись сразу (Artifact Signing от $9.99 в месяц или сертификат).** Отвергнуто (Q22): подпись —
  работа E4 вместе с внешними пользователями, а до тех пор worfy ставит только владелец.
  Исключение — Smart App Control (пункт 5).
- **Собирать установщик на Mac.** Не выбрано (Q22): на Mac pnpm без `supportedArchitectures` не
  ставит `claude.exe`, а `electronDist` указывает на Electron для macOS. На Windows-ПК установщик
  собирают там же, где его ставят и проверяют.
- **qmd в первых Ticket-ах порта.** Отвергнуто (Q21): работает ли qmd на Windows, не известно, а
  grep закрывает поиск до последнего Ticket-а.
