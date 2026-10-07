# worfy-windows: Windows-порт

Status: по решениям владельца 2026-10-07 (сводка решений Q1–Q25 подтверждена владельцем целиком);
«Готово, когда» и имя Epic-а подтверждены 2026-10-08
Source: [roadmap.md](../../docs/roadmap.md), раздел «worfy-windows — Windows-порт»;
[CONTEXT.md](../../CONTEXT.md); ADR этого Epic-а —
[ADR-0054](../../docs/adr/0054-full-windows-port.md),
[ADR-0055](../../docs/adr/0055-harness-scripts-in-node.md),
[ADR-0056](../../docs/adr/0056-windows-checks-and-two-sessions.md); Epic-а `worfy-link` —
[ADR-0052](../../docs/adr/0052-machines-and-linking.md),
[ADR-0053](../../docs/adr/0053-several-screens-on-one-project.md); ADR [0007](../../docs/adr/0007-claude-code-launch-environment.md),
[0008](../../docs/adr/0008-claude-code-native-binary-path.md),
[0023](../../docs/adr/0023-separate-data-roots-packaged-and-dev.md),
[0040](../../docs/adr/0040-harness-delivery-local-marketplace.md),
[0043](../../docs/adr/0043-qmd-is-part-of-harness.md),
[0044](../../docs/adr/0044-harness-in-english-language-from-profile.md) (в силе, на Windows
уточняются); бриф фактов о порте 2026-10-07 — пересказан в ADR-0054 и ADR-0055; Epic
[worfy-harness](../worfy-harness/spec.md) — формат и соглашения.
Ticket-ы: Epic `worfy-windows`, 16 Ticket-ов, нумерация с `01`. Шапка — тот же диалект, что у
worfy-harness (`Type:` / `Status:` / `Blocked by:` / `Source:`), чтобы её читали `epic-status`,
`ticket` и вычисление Wave в worfy (`src/shared/workflow/waves.ts`).

Q1–Q25 — вопросы Session проектирования «Несколько машин и порт под Windows» (2026-10-07). E3 —
Epic `worfy-harness` (Harness как plugin worfy). E4 — Epic «Для других людей»: подпись,
нотаризация, внешние пользователи.

## Цель

worfy работает на Windows целиком, а не как экран к Mac. Project, Canvas, агенты, Session-ы,
Terminal, Gate и Autopilot идут на самой Windows-машине. Пользователь, у которого есть только
Windows, тоже работает в worfy.

Epic готов, когда:

1. На чистой Windows 11 с Git for Windows, node и gh неподписанный установщик ставит worfy. Первый
   запуск проходит проверки, установщик E3 ставит Harness plugin.
2. На Windows работают Project worfy, Canvas, Session-ы, Terminal на PowerShell, Gate, epic-status.
   Одна Wave Autopilot проходит целиком: implementer, gate full на Windows, PR, мерж.
3. Скрипты Harness на Node работают на обеих системах, bash — только в test-ах, `.gitattributes`
   держит LF в скриптах.
4. qmd работает на Windows, или grep — явно запасной путь.
5. На Mac ничего не сломалось — gate full на Mac зелёный.

Здесь установщик E3 — Ticket 13 `worfy-harness`: worfy ставит Harness своей версии как plugin.
`epic-status` — скрипт Harness, который печатает строку этапа Epic-а. gate full — полный прогон
Gate. `.gitattributes` — файл git с правилами концов строк; LF — перевод строки без `\r`.

Проверку всех пяти пунктов делает Ticket 16.

## Как устроено

- **Полный порт** ([ADR-0054](../../docs/adr/0054-full-windows-port.md)). worfy на Windows — то же
  приложение, что на Mac. Windows-ПК с worfy — это Machine
  ([ADR-0052](../../docs/adr/0052-machines-and-linking.md)). Один репозиторий на Mac и на Windows —
  два разных Project-а. Работу с Project-ом другой Machine по локальной сети делает Epic
  `worfy-link`, а не этот.
- **Платформа.** Windows 10 21H2 (сборка 19044) и новее, Windows 11; только x64. Это выше порога
  ConPTY (псевдоконсоль Windows, её берёт node-pty) — сборки 18309, поэтому ветки winpty нет.
- **Git for Windows обязателен.** Claude Code на Windows исполняет Bash tool и hooks в Git Bash;
  без него у агента нет Bash tool. worfy сам находит Git Bash (от `git.exe` из `Path`, затем в
  стандартных папках установки) и передаёт его Claude Code переменной `CLAUDE_CODE_GIT_BASH_PATH`
  (Ticket 09). `C:\Windows\System32\bash.exe` — это
  запуск WSL, его worfy не берёт никогда.
- **Окружение агента на Windows** (Ticket 09). Login shell нет. Основа — окружение процесса worfy
  без ключей API и без переменных родительской Session Claude Code; переменные пользователя из
  реестра Windows остаются. Решение — новый ADR этого Ticket-а. На Mac ADR-0007 (окружение из login
  shell) в силе.
- **Harness на Node** ([ADR-0055](../../docs/adr/0055-harness-scripts-in-node.md)). Всё, что зовут hooks,
  worfy, skills и agents, переписывается на Node: Gate — `harness/hooks/gate.mjs` (Ticket 03),
  четыре hooks (Ticket 04), `epic-status` и правки остальных скриптов `bin` (Ticket 05),
  `preflight` (Ticket 06), обёртки qmd (Ticket 15).
  - Вызов — явным `node "${CLAUDE_PLUGIN_ROOT}/…"`, а не по shebang (строке `#!` в начале файла).
    Скрипт зовёт соседа через `process.execPath`.
  - Контракт скриптов прежний: имена, аргументы, коды выхода, вывод, файлы вердикта Gate и маркеры.
  - bash остаётся только в test-ах Harness. На Windows они идут в Git Bash с `jq` и perl.
  - `.gitattributes` держит LF в скриптах и test-ах (Ticket 02).
- **Пути и данные** (Ticket 08). Папка данных — `%APPDATA%\worfy` у установленной сборки и
  `%APPDATA%\worfy-dev` у dev-запуска; правило ADR-0023 (раздельные папки) в силе. Папка Claude
  Code — `%USERPROFILE%\.claude`. Абсолютный путь проверяет одна функция `src/shared/paths.ts`:
  `/…`, `C:\…`, `C:/…`, `\\server\share\…`. Мост Limits (скрипт `statusLine`, который передаёт
  Limits из терминала в worfy) — на Node.
- **Terminal** (Ticket 10). PowerShell: `pwsh.exe`, а без него Windows PowerShell. Git Bash —
  выбор в настройках Project-а (место настройки предлагает Ticket 10, подтверждает владелец).
  `cmd.exe` не используется. Закрытие Terminal гасит всё дерево
  процессов оболочки.
- **Окно, меню, клавиши** (Ticket 11). Обычная рамка окна Windows с меню (предложение Ticket-а 11,
  подтверждает владелец). Ctrl там, где на Mac ⌘.
  `app.setAppUserModelId` до первого окна — без него уведомления Windows не показываются.
- **Сборка** (Ticket 12). Неподписанный установщик NSIS (формат установщика, который собирает
  electron-builder), x64. Его собирает Session на Windows-ПК владельца: там pnpm сам ставит
  `claude.exe` из пакета SDK. Stable copy на Windows — папка; путь предлагает Ticket 12
  (`%LOCALAPPDATA%\Programs\worfy-stable`), подтверждает владелец.
- **Первый запуск** (Ticket 13). Экран первого запуска E3 (Ticket 19 `worfy-harness`) получает ветку
  для Windows: Git Bash, `git`, `gh`, node ≥ 22, `jq`, PowerShell, версия и архитектура Windows.
  Подсказки — `winget install <id>` вместо `brew install`. Установщик Harness E3 ставит plugin
  встроенным `claude.exe`.
- **Проверка Windows** ([ADR-0056](../../docs/adr/0056-windows-checks-and-two-sessions.md)). CI на PR —
  только Linux. Платформенный PR мержится после gate full на Windows-ПК владельца. Ручной job
  «Windows» в CI добавляет Ticket 14.
- **qmd** (Ticket 15). Путь А — qmd работает на Windows и ставится с экрана первого запуска. Путь Б —
  не работает: worfy не даёт Session-ам сервер qmd, экран первого запуска говорит «agents search
  with grep». Путь выбирает Ticket 15 по прогону на ПК.
- **Две Session-и** (ADR-0056). Этот Epic ведёт Session на Windows-ПК владельца, `worfy-link` —
  Session на Mac. Прямого канала между ними нет, общее — репозиторий: main, ветки, PR, файлы
  Ticket-ов, `HANDOFF.md`. Пара Mac и Windows в приёмке `worfy-link` ждёт worfy на Windows из этого
  Epic-а ([roadmap.md](../../docs/roadmap.md), раздел «worfy-link — Linked machines»).

## Этапы

1. **Факты на живой Windows** — 01. Бриф фактов собран чтением кода и документации, на Windows
   ничего не запускалось. Ticket 01 — первый Ticket Session на Windows-ПК:
   - ставит инструменты через winget с согласия владельца и пробует `pnpm install`, `pnpm dev`,
     `pnpm lint`, `pnpm typecheck`, `pnpm test`;
   - проверяет 15 фактов (сборка Windows, Smart App Control, `core.autocrlf`, `bash` в PATH,
     утилиты Git Bash, пути у git, домашняя папка, node-pty без Build Tools, оболочка скриптов pnpm,
     длина пути, имя папки транскриптов, hooks, `claude.exe`, qmd);
   - описывает скрипты Harness на main после закрытия E3 и приписывает каждый к Ticket-у порта;
   - пишет, как Session ведёт Epic, пока Harness не на Node;
   - правит Ticket-ы 02–16 по фактам. Итог — один docs-PR в `.scratch/worfy-windows`.
2. **Репозиторий на Windows** — 02. `.gitattributes` с LF для скриптов; `pnpm install` без Visual
   Studio Build Tools, если готовая сборка node-pty `prebuilds/win32-x64` грузится в Electron;
   скрипт `test` с префиксом `ELECTRON_RUN_AS_NODE=1` работает и там, где pnpm исполняет скрипты
   через `cmd.exe`; раздел «Development on Windows» в `README.md`. Список упавших на Windows test-ов
   — в Итог, для Ticket-а 14.
3. **Harness на Node** — 03–07.
   - 03: Gate на Node (`gate.mjs`, `gate-paths.mjs`), `gate.sh` удаляется; без зашитого PATH macOS;
     запуск `pnpm.cmd`; как hook находит node; worfy узнаёт вызов Gate по обоим именам и понимает
     пути Windows в `src/main/gate/state.ts` и `src/shared/ipc/checks.ts`.
   - 04: hooks `inject-rules`, `session-start`, `session-end`, `stop` на Node; каждая команда
     `hooks.json` — через `node`; hooks, которые добавит E3 (`gh-token-env`), — так же.
   - 05: `epic-status` на Node с прежним выводом байт в байт; `os.homedir()` вместо `HOME`; соседи
     через `process.execPath`; `epic-board` открывает страницу командой своей системы; worfy зовёт
     `epic-status` и `profile` через `node` в окружении агента.
   - 06: `preflight` на Node; тайм-аут без perl гасит дерево процессов (`taskkill /T /F` на
     Windows); без `jq` и awk.
   - 07: тексты skills без BSD-команд (`stat -f %m`, `date -v-14d`); шаг для Windows в ручных
     проверках GUI `ship-ticket`; в `epic-wave` — проверка открытых PR других Epic-ов перед Wave и
     перебазирование ветки в состоянии `BEHIND`.
4. **worfy на Windows** — 08–11.
   - 08: папка данных, Claude home, одна функция абсолютного пути, `/` и `\` в чтении транскриптов и
     в Binding, имя папки транскриптов, живые Session-ы без `ps`, мост Limits на Node.
   - 09: окружение агента без login shell, поиск Git Bash, путь `claude.exe`, новый ADR.
   - 10: Terminal на PowerShell, выбор Git Bash в настройках Project-а, канал `terminal.shells`,
     закрытие гасит дерево процессов.
   - 11: модуль `src/renderer/platform.ts`, Ctrl вместо ⌘ в сочетаниях и подписях, Ctrl+K и Ctrl+F
     внутри Terminal уходят в оболочку, рамка окна Windows, `AppUserModelId`.
5. **Сборка и первый запуск** — 12–13.
   - 12: секция `win:` в `electron-builder.yml` (NSIS x64, без подписи), `build/icon.ico`, Stable
     copy на обеих системах через `scripts/install-stable.mjs`, отказ Autopilot над worfy из
     dev-сборки на путях Windows. Smart App Control блокирует установщик — Ticket `blocked`, вопрос
     подписи — владельцу сразу.
   - 13: проверки машины на Windows, установщик Harness с `claude.exe`, мост Limits в `statusLine`
     на Windows через окно подтверждения.
6. **Проверки на Windows** — 14. Unit-, contract- и e2e-test-ы зелёные на ПК; пять test-ов «только
   macOS» разобраны; `Meta` → `ControlOrMeta` в e2e; e2e Terminal на PowerShell; e2e собранного
   приложения на `dist\win-unpacked\worfy.exe`; подмена `gh` и `claude` на Windows; ручной job
   «Windows» в CI. С его мержа правило Q23 действует целиком.
7. **qmd** — 15. Обёртки `qmd-mcp`, `qmd-refresh`, `qmd-sync-main` на Node; `.mcp.json` и Stop-hook
   через `node`; путь А или Б.
8. **Приёмка** — 16. Contract test пункта 3 «Готово, когда»; чистая Windows 11 (шаг владельца);
   Wave Autopilot из Stable copy на ПК; qmd или grep; gate full на Mac.

## Решения владельца

Session проектирования «Несколько машин и порт под Windows», 2026-10-07. Номер вопроса — как в той
Session (Q1–Q25). Ticket-ы ссылаются на эти номера и на ADR.

- **Полный порт** — [ADR-0054](../../docs/adr/0054-full-windows-port.md) (Q1). Агенты работают на самой
  Windows-машине. Порт делает отдельная Session на Windows-ПК владельца. Владелец отверг браузерный
  клиент (worfy на Mac раздаёт UI по HTTP) и тонкий клиент (Electron на Windows только показывает
  worfy с Mac). WSL отвергнут в ADR-0054 (Considered Options), а не владельцем. Сценарий «работа идёт
  на Mac, экран — на Windows» закрывает `worfy-link` поверх порта.
- **Machine** — [ADR-0052](../../docs/adr/0052-machines-and-linking.md) (Q7, Q9). Machine — компьютер с
  worfy; у Project ровно одна Machine. Один репозиторий на двух Machine — два Project-а. host и
  client — роли соединения, а не виды Machine. Остальное о Linked machine — Q2–Q6, Q10, Q11,
  Q13–Q17, Epic `worfy-link` (ADR-0052,
  [ADR-0053](../../docs/adr/0053-several-screens-on-one-project.md)).
- **Платформа** — ADR-0054 (Q24). Windows 10 21H2+ и 11, x64. arm64 — позже.
- **Git for Windows и node** — ADR-0054 (Q18). Git for Windows обязателен: первый запуск его проверяет
  и показывает `winget install Git.Git`, сам worfy его не ставит. node ≥ 22 — как на Mac.
- **Terminal** — ADR-0054 (Q20). PowerShell: `pwsh`, иначе Windows PowerShell. Git Bash — в
  настройках. Bash tool агента от этой настройки не зависит: он всегда в Git Bash.
- **Установщик и подпись** — ADR-0054 (Q22). Неподписанный NSIS собирает Session на ПК владельца.
  Подпись — в E4. Если на машине включён Smart App Control (защита Windows 11, которая не даёт
  запускать неподписанные программы), вопрос подписи встаёт сразу.
- **qmd** — ADR-0054 (Q21). Последним Ticket-ом порта. До него агенты на Windows ищут grep-ом по
  `qmd.fallback_grep` Profile-а. Если qmd на Windows не заработает, grep остаётся явным запасным
  путём, а не молчаливой заменой.
- **Скрипты Harness** — [ADR-0055](../../docs/adr/0055-harness-scripts-in-node.md) (Q19). Всё, что
  вызывают hooks и worfy, — на Node; bash — только в test-ах. Почему:
  - Git Bash — это GNU coreutils, и `stat -f` там значит другое, чем в BSD-утилитах macOS
    (сведения о файловой системе, а не о файле); `date -v` GNU `date` не знает;
  - вызов по shebang в hooks на Windows ненадёжен: нужен явный `node …`;
  - обёртки qmd написаны на zsh, а zsh в Git Bash нет.

  `.gitattributes` с LF для скриптов решён без отдельного вопроса. Отвергнуты: bash под Git Bash с
  ветками флагов, двойники на PowerShell, скрипты через WSL, переписать test-ы на Node.
- **Проверка Windows** — [ADR-0056](../../docs/adr/0056-windows-checks-and-two-sessions.md) (Q23).
  Windows-раннера на PR нет. Платформенный PR мержится после gate full на Windows-ПК владельца;
  «не удалось проверить» — не зелено. Ручной job «Windows» в CI — только `workflow_dispatch`.
- **Порядок и две Session-и** — ADR-0056 (Q12, Q25). Спроектировано сейчас, делается после E3 (Q8).
  `worfy-link` и `worfy-windows` идут параллельно, каждый на своей машине. Session-и общаются через репозиторий.
  Перед Wave — проверка открытых PR второго Epic-а на общие файлы. Мерж в main — по очереди.
- **Один Autopilot на Epic** — ADR-0053, пункт 9 (Q13). Autopilot на Mac и на Windows идут
  одновременно над разными Epic-ами — запрет им не мешает.
- **Epic** — имя `worfy-windows`, пять пунктов «Готово, когда» (подтверждены 2026-10-08). E4 — после
  `worfy-link` и `worfy-windows`.

## Не в этом Epic-е

- **Windows на arm64** — позже (Q24).
- **Подпись установщика и репутация SmartScreen** — E4 (Q22). Исключение — Smart App Control на ПК
  владельца или на чистой Windows: тогда вопрос подписи уходит владельцу сразу.
- **Сборка Windows-установщика на Mac** — не выбрано (ADR-0054): pnpm без `supportedArchitectures` не
  ставит на Mac `claude.exe`, а `electronDist` указывает на Electron для macOS.
- **Windows-раннер на PR** — нет (Q23).
- **Linked machines** — работа с Project-ом другой Machine, связь по коду, несколько экранов на одном
  Project — Epic `worfy-link`.
- **Linux-сборка worfy** — нет. CI на Linux гоняет test-ы, а не приложение.
- **Test-ы Harness на Node** — не выбрано (ADR-0055): 13 test-ов на bash остаются и проверяют
  Node-скрипты снаружи, по контракту.
- **Внешние пользователи Windows-сборки** — до E4 worfy на Windows ставит только владелец.

## Риски и открытые технические вопросы

1. **Факты брифа не проверены на Windows** (Ticket 01). Не установлено:
   - кодирует ли Claude Code путь `C:\a\b` в имя папки транскриптов так же, как
     `projectDirName` worfy (`src/main/claude-home/registry.ts:42-47`);
   - грузится ли готовая сборка node-pty в Electron без Visual Studio Build Tools;
   - через какую оболочку pnpm на Windows исполняет скрипты `package.json`;
   - ставит ли Git for Windows по умолчанию `core.autocrlf=true` (знаем из вторичных источников);
   - хватает ли лимита пути Windows в 260 символов (MAX_PATH) для
     `.claude\worktrees\…\node_modules\.pnpm`;
   - работает ли вызов по shebang в hooks; в каком виде приходят `${CLAUDE_PLUGIN_ROOT}`, `cwd` и
     `tool_input.file_path`; доходит ли `CLAUDE_ENV_FILE` до Bash tool;
   - есть ли в Git Bash `jq`, perl, `shasum`; какой `bash` первым в PATH;
   - что печатает git на Windows: `C:/…`, `C:\…` или `/c/…`;
   - работает ли qmd на Windows; включён ли Smart App Control на ПК.

   Факт разошёлся с брифом — Ticket 01 правит Ticket-ы до начала работы. Факт снимает работу
   Ticket-а целиком — Ticket не удаляется, решение о закрытии уходит владельцу. Если в Git Bash не
   работает вызов по shebang, skills и agents тоже переходят на явный `node` (ADR-0055, пункт 2): этот
   срез Ticket 01 добавляет в Epic.
2. **Ticket-ы описывают main 4f983ef, а E3 ещё идёт.** На 2026-10-08 у E3 открыты Ticket-ы 13–26.
   Они добавляют скрипты (`harness/hooks/gh-token-env.sh`, `harness/bin/qmd-collections`,
   `harness/bin/silent-check`, `harness/bin/project-connect`) и код экрана первого запуска,
   установщика Harness и qmd. Ticket-ы 13 и 15 взяли пути из планов E3. Ticket-ы 09, 10, 12 и 15
   велят перечитать свои файлы на свежем main. Опись скриптов после закрытия E3 и правку путей делает
   Ticket 01.
3. **Gate — самая рискованная часть** (ADR-0055).
   - Пока Gate не на Node (до Ticket-а 03), вердикт на Windows — `pnpm lint`, `pnpm typecheck`,
     `pnpm test` с кодами выхода, и отчёт прямо говорит «Gate не запускался».
   - Тег worktree (8 hex SHA-1 пути) Gate считает от вывода `git rev-parse --show-toplevel`, а worfy —
     от `realpath.native`. На Windows написания могут разойтись, и worfy не найдёт маркер и файл
     вердикта. Ticket 03 приводит путь к одному написанию.
   - С командой `node …` в `hooks.json` node должен быть в PATH Claude Code до запуска hook-а. Как
     hook находит node на обеих системах, решает Ticket 03; без node hook падает, не блокируя
     Session, и worfy показывает «прогонов нет».
4. **Как Session ведёт Epic до Harness на Node.** Session на Windows-ПК — первая там; worfy под
   Windows ещё не собран, и она работает в Claude Code без worfy (ADR-0056). Как Harness и Profile
   worfy попадают на ПК, какие скрипты идут в Git Bash как есть и какие заменяются командами
   вручную, — раздел evidence Ticket-а 01 «Как ведётся Epic, пока Harness не на Node». Autopilot над
   worfy идёт только из Stable copy, а Stable copy на Windows появляется в Ticket-е 12. До того
   Wave-ы ведёт сама Session в Claude Code.
5. **Платформенные PR ждут ПК владельца** (ADR-0056). Мерж ждёт включённого Windows-ПК; PR Session
   Mac, который оказался платформенным, тоже ждёт. Регрессию на Windows из PR, который не сочли
   платформенным, CI на Linux не поймает — её увидит следующий gate full на Windows.
6. **gate full на Mac для PR Session Windows — не решено.** Ticket-ы этого Epic-а держат в «Готово,
   когда» «Mac: gate full зелёный», а Session на Windows прогнать его не может. ADR-0056 этот вопрос
   оставил открытым. Ticket 16 (пункт 5 «Готово, когда» Epic-а) просит прогон через `HANDOFF.md`,
   раздел «Ждёт владельца»: его делает Session на Mac или владелец. Для остальных Ticket-ов кто и
   когда гонит gate full на Mac — не решено, это вопрос владельцу.
7. **Общие файлы двух Epic-ов.** План ниже не знает о PR `worfy-link`. Перед каждой Wave Session
   сверяет файлы своих Ticket-ов с файлами открытых PR `worfy-link`; до Ticket-а 07 — вручную.
   `HANDOFF.md` — один файл на репозиторий; конфликт в нём решает Session, которая мержит второй.
8. **`jq` на чистой Windows.** Skills зовут `jq` из Git Bash и после порта. Пункт 1 «Готово, когда»
   называет только Git for Windows, node и gh. Если в Git for Windows `jq` нет, экран первого запуска
   покажет `fail` с `winget install jqlang.jq` — это расходится с пунктом 1. Тогда вопрос владельцу
   (Ticket-ы 01, 13, 16).
9. **Terminal и Bash tool на Windows — разные оболочки:** PowerShell и Git Bash. Команда из ответа
   агента, вставленная в Terminal, может там не сработать (ADR-0054, «Последствия»). Закрытие Terminal
   на Windows гасит и процессы, запущенные из него через `Start-Process`; на Mac приложение из
   `open` закрытие Terminal переживает (Ticket 10).
10. **Списки «Где в коде» ещё растут.** Ticket 14 дописывает файлы из списка упавших test-ов
    Ticket-а 02 до начала работы. Ticket 12 добавит `src/main/autopilot/run.ts`, если test покажет
    расхождение путей. Ticket 13 добавит `src/renderer/shell/FirstRun.tsx`, если общий код экрана не
    рисует новую проверку. Ticket 01 правит пути Ticket-ов 13 и 15 по коду E3. От этого Wave-ы плана
    могут сдвинуться.
11. **План Wave-ов — прогноз.** Wave, которую берут в работу, вычисляется заново в момент запуска
    (CONTEXT.md, термин Wave).

## Соглашения для Ticket-ов этого Epic-а

Как в [worfy-harness](../worfy-harness/spec.md), раздел «Соглашения для Ticket-ов этого Epic-а»:
сначала падающий test, виды test-ов, только чтение чужих файлов, ручные пункты «(вручную)», снимки
UI в двух темах, Autopilot над worfy — только на Stable copy. Отличия:

- **Начало — после закрытия E3** (`worfy-harness`). Ticket 01 работает на main после последнего
  мержа E3.
- **Кто ведёт.** Epic ведёт Session на Windows-ПК владельца. Session на Mac ведёт `worfy-link` и
  Ticket-ы этого Epic-а не берёт. Ticket 16 Autopilot не берёт: в нём шаги владельца, его ведёт
  Orchestrator Session на Windows.
- **Ветки** — `worfy-windows/<NN>`; worktree — `.claude/worktrees/<NN>`.
- **ADR.** Номера ADR выдаёт Orchestrator в момент взятия Ticket-а, по одному решению на файл.
  Принятые ADR 0001–0056 не правятся: уточнение — новым ADR, который говорит, что он уточняет. Новый
  ADR ждёт Ticket 09 (окружение агента на Windows).
- **Перед каждой Wave — открытые PR `worfy-link`** (Q25, ADR-0056, пункт 5). Файлы открытых PR
  второго Epic-а сравниваются с файлами «Где в коде» Ticket-ов Wave. Ticket с общим файлом в Wave не
  берётся, пока тот PR не влит. В отчёте Wave — Ticket, файл и номер PR. До Ticket-а 07 проверка
  идёт вручную (`gh pr list --state open --json number,headRefName,files`), порядок — evidence
  Ticket-а 01.
- **Мерж по очереди** (Q12, ADR-0056, пункт 6). За раз вливается один PR. Второй перед мержем
  перебазируется на свежий main, и его проверки идут заново.
- **Платформенный PR — после gate full на Windows-ПК** (Q23, ADR-0056, пункт 2). Строка вердикта Gate
  и код выхода — в отчёт Ticket-а; «не удалось проверить» — не зелено.
  - До Ticket-а 03 Gate на Windows нет: `pnpm lint`, `pnpm typecheck`, `pnpm test` с кодами выхода
    и пометка «Gate не запускался».
  - До мержа Ticket-а 14 gate full на Windows может быть красным из-за test-ов, которые чинит 14.
    Хватает проверки своего среза на Windows: падения `pnpm test` сверены со списком Ticket-а 02,
    новых нет. С мержа Ticket-а 14 — gate full на Windows зелёный перед каждым платформенным PR.
- **Ручной job «Windows»** (Ticket 14) — только `workflow_dispatch`, запуск — с согласия владельца:
  минута Windows стоит $0.010.
- **CI на PR** — только Linux: lint, typecheck, unit и contract test-ы. e2e, сборка `.app` и
  установщика — локально перед мержем.
- **Ветки Windows проверяются на Mac и в Linux CI.** Система, окружение и ответы команд передаются в
  функцию параметром; пути Windows собираются через `path.win32`. Test-ы с настоящими PowerShell,
  Git Bash и pty — `it.runIf(process.platform === 'win32')`, на ПК они обязательны.
- **Test-ы Harness на Windows** — `.test.sh` в Git Bash с `jq` и perl. Случаи zsh на Windows
  печатают `skip` с причиной; на Mac и Linux отсутствие zsh — провал.
- **Песочница.** Test-ы не пишут в настоящую папку пользователя и не трогают настоящий
  `%USERPROFILE%\.claude`. Test, который подменяет `HOME`, задаёт тем же путём `USERPROFILE`: Node
  `os.homedir()` на Windows читает его. Установщик Harness проверяется с `CLAUDE_CONFIG_DIR` во
  временной папке, как в E3. Hooks Ticket 01 проверяет в папке-песочнице через её
  `.claude\settings.local.json`.
- **Evidence** — `.scratch/worfy-windows/evidence/`: выводы команд и снимки с ПК.
- **Только чтение.** Писать в `/Users/alexey/Work/*` нельзя.
- **Шаги владельца.** Установки через winget — с его согласия. Вход в Claude и в `gh`, системные
  запросы Windows (SmartScreen, Smart App Control), чистая Windows 11 для приёмки — делает
  владелец.
- **Язык.** Текст Harness — английский (ADR-0044). Документы Project-а — русские, термины — из
  `CONTEXT.md`.

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде»
нет. Таблица — план. Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md,
термин Wave). Заголовок раздела и шапка таблицы остаются русскими: это формат, который читает skill
`epic-wave`.

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `.scratch/worfy-windows/evidence/01-факты-windows.md` | 1 |
| 02 | `.gitattributes`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `README.md`, `scripts/postinstall.mjs`, `test/contract/postinstall.test.ts` | 2 |
| 03 | `harness/hooks/gate.mjs`, `harness/hooks/gate-paths.mjs`, `harness/hooks/gate.sh`, `harness/hooks/gate-resolve.mjs`, `harness/hooks/hooks.json`, `harness/hooks/stop.sh`, `harness/hooks/rules/common.md`, `harness/agents/implementer.md`, `harness/skills/ship-ticket/SKILL.md`, `harness/skills/epic-wave/SKILL.md`, `harness/skills/overnight-fix-loop/SKILL.md`, `harness/bin/profile`, `harness/bin/preflight`, `harness/README.md`, `harness/profiles/README.md`, `harness/hooks/tests/gate-notverified.test.sh`, `harness/hooks/tests/gate-unregistered.test.sh`, `harness/hooks/tests/gate-verdict.test.sh`, `harness/hooks/tests/rules-hooks.test.sh`, `harness/bin/tests/agents-text.test.sh`, `harness/bin/tests/epic-wave-ship-ticket.test.sh`, `harness/bin/tests/harness-home.test.sh`, `src/main/gate/state.ts`, `src/shared/ipc/checks.ts`, `test/unit/gate-state.test.ts`, `test/contract/harness-plugin.test.ts`, `test/contract/harness-scripts.test.ts`, `test/e2e/packaged.spec.ts`, `CONTEXT.md` | 3 |
| 04 | `harness/hooks/inject-rules.mjs`, `harness/hooks/session-start.mjs`, `harness/hooks/session-end.mjs`, `harness/hooks/stop.mjs`, `harness/hooks/inject-rules.sh`, `harness/hooks/session-start.sh`, `harness/hooks/session-end.sh`, `harness/hooks/stop.sh`, `harness/hooks/hooks.json`, `harness/hooks/gate.mjs`, `harness/hooks/gate-resolve.mjs`, `harness/hooks/gh-token-env.sh`, `harness/hooks/gh-token-env.mjs`, `harness/hooks/tests/gh-token-env.test.sh`, `harness/hooks/tests/rules-hooks.test.sh`, `harness/hooks/tests/session-hooks.test.sh`, `harness/hooks/tests/gate-notverified.test.sh`, `harness/hooks/tests/gate-unregistered.test.sh`, `harness/bin/tests/harness-home.test.sh`, `harness/README.md`, `harness/profiles/README.md`, `harness/skills/retro/SKILL.md`, `harness/skills/tickets-to-tasks/SKILL.md`, `test/contract/harness-plugin.test.ts` | 4 |
| 05 | `harness/bin/epic-status`, `harness/bin/profile`, `harness/bin/ticket`, `harness/bin/worktree-lock`, `harness/bin/epic-board`, `harness/bin/tests/epic-status.test.sh`, `harness/bin/tests/harness-home.test.sh`, `src/main/workflow/reader.ts`, `src/main/workflow/profile.ts`, `test/contract/workflow-reader.test.ts`, `test/contract/workflow-profile.test.ts`, `test/contract/github-prs.test.ts`, `test/contract/projects.test.ts`, `test/e2e/autopilot.spec.ts`, `test/e2e/binding.spec.ts`, `test/e2e/card-api.spec.ts`, `test/e2e/checks-badges.spec.ts`, `test/e2e/done-stack.spec.ts`, `test/e2e/edges.spec.ts`, `test/e2e/epic-frame-undo.spec.ts`, `test/e2e/epic-frame.spec.ts`, `test/e2e/new-session.spec.ts`, `test/e2e/no-overlap.spec.ts`, `test/e2e/palette-find.spec.ts`, `test/e2e/projects.spec.ts`, `test/e2e/ship-ticket.spec.ts`, `test/e2e/snapping.spec.ts`, `test/e2e/subagent-tree.spec.ts`, `test/e2e/theme-shadows.spec.ts` | 5 |
| 06 | `harness/bin/preflight`, `harness/bin/tests/preflight.test.sh`, `harness/bin/tests/harness-home.test.sh` | 6 |
| 07 | `harness/skills/epic-wave/SKILL.md`, `harness/skills/continuous-audit/SKILL.md`, `harness/skills/ship-ticket/SKILL.md`, `harness/bin/tests/skill-blocks.test.sh`, `harness/bin/tests/epic-wave-ship-ticket.test.sh` | 6 |
| 08 | `src/main/storage/paths.ts`, `src/shared/paths.ts`, `src/shared/ipc/claude-home.ts`, `src/shared/ipc/bindings.ts`, `src/shared/cards/last-editor.ts`, `src/renderer/markdown/links.ts`, `src/shared/binding/signals.ts`, `src/shared/binding/resolve.ts`, `src/shared/workflow/ticket-ref.ts`, `src/shared/transcript/subagents.ts`, `src/main/claude-home/registry.ts`, `src/main/claude-home/binding-signals.ts`, `src/main/claude-home/subagents.ts`, `src/main/agent/limits.ts`, `src/shared/autopilot/journal.ts`, `scripts/statusline-bridge.mjs`, `scripts/statusline-bridge.sh`, `electron-builder.yml`, `test/unit/paths.test.ts`, `test/unit/platform-paths.test.ts`, `test/unit/markdown.test.tsx`, `test/unit/binding.test.ts`, `test/unit/ticket-ref.test.ts`, `test/contract/card-last-editor.test.ts`, `test/contract/claude-home-registry.test.ts`, `test/contract/claude-home-subagents.test.ts`, `test/contract/statusline-bridge.test.ts`, `test/e2e/packaged.spec.ts` | 4 |
| 09 | `src/main/agent/env.ts`, `src/main/agent/options.ts`, `test/unit/agent-env.test.ts`, `test/unit/agent-executable.test.ts` | 3 |
| 10 | `src/main/terminal/pty.ts`, `src/main/ipc/terminal.ts`, `src/shared/ipc/terminal.ts`, `src/shared/projects/action-templates.ts`, `src/main/projects/settings.ts`, `src/renderer/shell/ProjectSettings.tsx`, `test/unit/terminal-shell.test.ts`, `test/contract/terminal.test.ts`, `test/contract/projects.test.ts` | 4 |
| 11 | `src/main/window.ts`, `src/main/menu.ts`, `src/main/index.ts`, `src/main/notify.ts`, `src/renderer/platform.ts`, `src/renderer/main.tsx`, `src/renderer/shell/shell.css`, `src/renderer/focus/focus.css`, `src/renderer/canvas/Canvas.tsx`, `src/renderer/canvas/overlays/FocusEntry.tsx`, `src/renderer/canvas/overlays/SelectionToolbar.tsx`, `src/renderer/focus/FocusMode.tsx`, `src/renderer/find/CanvasFind.tsx`, `src/renderer/palette/CommandPalette.tsx`, `src/renderer/session/MessageInput.tsx`, `test/unit/platform-keys.test.ts`, `test/unit/window-options.test.ts`, `test/contract/app-user-model-id.test.ts`, `test/contract/view-menu.test.ts` | 3 |
| 12 | `electron-builder.yml`, `package.json`, `scripts/make-icons.mjs`, `build/icon.ico`, `build/icons.json`, `scripts/install-stable.sh`, `scripts/install-stable.mjs`, `src/main/ipc/autopilot.ts`, `test/contract/make-icons.test.ts`, `test/unit/install-stable.test.ts`, `test/contract/autopilot.test.ts`, `test/e2e/packaged.spec.ts`, `CONTEXT.md`, `README.md` | 5 |
| 13 | `src/main/first-run/checks.ts`, `src/main/first-run/actions.ts`, `src/shared/ipc/first-run.ts`, `src/main/harness/install.ts`, `src/main/harness/migrate/plan.ts`, `src/main/harness/migrate/apply.ts`, `docs/design/F-SPEC.md`, `test/unit/first-run-windows.test.ts`, `test/contract/first-run-checks.test.ts`, `test/contract/harness-install.test.ts`, `test/contract/harness-migrate.test.ts` | 6 |
| 14 | `test/e2e/canvas-layout.spec.ts`, `test/e2e/epic-frame-undo.spec.ts`, `test/e2e/wheel-over-nodes.spec.ts`, `test/e2e/focus.spec.ts`, `test/e2e/snapping.spec.ts`, `test/e2e/trash-undo.spec.ts`, `test/e2e/pin-tags.spec.ts`, `test/e2e/edges.spec.ts`, `test/e2e/theme-shadows.spec.ts`, `test/e2e/no-overlap.spec.ts`, `test/e2e/epic-frame.spec.ts`, `test/e2e/palette-find.spec.ts`, `test/e2e/tidy-up.spec.ts`, `test/e2e/terminal.spec.ts`, `test/e2e/packaged.spec.ts`, `test/e2e/helpers.ts`, `test/fixtures/gh/gh`, `test/fixtures/gh/gh-stub.mjs`, `test/contract/github-prs.test.ts`, `test/contract/harness-scripts.test.ts`, `test/contract/harness-install.test.ts`, `test/unit/agent-env.test.ts`, `test/unit/tail.test.ts`, `test/contract/workflow-reader.test.ts`, `test/contract/terminal.test.ts`, `test/contract/make-icons.test.ts`, `src/main/github/prs.ts`, `src/main/ipc/checks.ts`, `.github/workflows/ci.yml` | 7 |
| 15 | `harness/bin/qmd-mcp`, `harness/bin/qmd-refresh`, `harness/bin/qmd-sync-main`, `harness/bin/qmd-collections`, `harness/.mcp.json`, `harness/hooks/hooks.json`, `harness/skills/qmd/SKILL.md`, `harness/bin/tests/qmd.test.sh`, `harness/bin/tests/harness-home.test.sh`, `harness/bin/tests/qmd-collections.test.sh`, `src/main/harness/qmd.ts`, `src/main/first-run/checks.ts`, `src/main/workflow/profile.ts`, `docs/design/F-SPEC.md`, `test/contract/harness-qmd.test.ts`, `test/contract/workflow-profile.test.ts`, `test/contract/first-run-checks.test.ts`, `test/contract/harness-scripts.test.ts`, `.github/workflows/ci.yml` | 8 |
| 16 | `test/contract/harness-node-only.test.ts`, `.scratch/worfy-windows/evidence/16-чистая-windows.md`, `.scratch/worfy-windows/evidence/16-чистая-установка.png`, `.scratch/worfy-windows/evidence/16-первый-запуск.png`, `.scratch/worfy-windows/evidence/16-canvas.png`, `.scratch/worfy-windows/evidence/16-session.png`, `.scratch/worfy-windows/evidence/16-terminal-powershell.png`, `HANDOFF.md` | 9 |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры (`Blocked by`). Если у двух
Ticket-ов одной Wave общий файл, Ticket с большим номером уходит в следующую Wave.

- **Wave 1 — 01, один.** Блокеров нет. Он правит Ticket-ы 02–16, поэтому остальные ждут его: 02 —
  прямо, остальные — через 02.
- **Wave 2 — 02, один.** Ждёт 01.
- **Wave 3 — 03, 09 и 11.** Все ждут только 02. Общих файлов нет: 03 — Gate в `harness/` и чтение
  Gate в worfy, 09 — `src/main/agent/env.ts` и `options.ts`, 11 — окно, меню и клавиши. 08 тоже ждёт
  только 02 — сдвинут (ниже).
- **Wave 4 — 04, 08 и 10.** 04 ждёт 03, 08 — 02, 10 — 09. Общих файлов нет: 04 — hooks в
  `harness/hooks`, 08 — пути в `src`, мост Limits, `electron-builder.yml` и
  `test/e2e/packaged.spec.ts`, 10 — Terminal и настройки Project-а. 05 и 06 по блокерам тоже здесь —
  сдвинуты.
- **Wave 5 — 05 и 12.** 05 ждёт 03 и 09, 12 — 08 и 09. Общих файлов нет: 05 — `harness/bin`, вызов
  скриптов в `src/main/workflow` и stub-ы `epic-status` и `profile` в test-ах, 12 — сборка, иконки,
  Stable copy и `src/main/ipc/autopilot.ts`. Stub-ы дают 05 общие файлы с 10
  (`test/contract/projects.test.ts`) и с 14 (e2e-файлы, `test/contract/github-prs.test.ts`); план
  это не меняет: 10 — в Wave 4, 14 — в Wave 7.
- **Wave 6 — 06, 07 и 13.** 06 ждёт 03, 07 — 03 и 12, 13 — 04, 05 и 12. Общих файлов нет: 06 —
  `preflight` и `harness-home.test.sh`, 07 — тексты skills `epic-wave`, `continuous-audit`,
  `ship-ticket` и их test-ы, 13 — экран первого запуска и установщик Harness.
- **Wave 7 — 14, один.** Ждёт 03, 08, 10, 11 и 12; сдвинут.
- **Wave 8 — 15, один.** Ждёт 06, 07, 13 и 14.
- **Wave 9 — 16, один.** Ждёт 15. Autopilot его не берёт: в нём шаги владельца.

Сдвиги из-за общих файлов:

- **08: Wave 3 → 4.** С 03 общий `test/e2e/packaged.spec.ts`. Абзац под списком «Где в коде»
  Ticket-а 03 говорит, что общих файлов с 08 нет; по самим спискам общий файл есть. Отсюда 12 — в
  Wave 5 (ждёт 08), 07 — в Wave 6 (ждёт 12).
- **05: Wave 4 → 5.** С 04 общий `harness/bin/tests/harness-home.test.sh`. Отсюда 13 — в Wave 6
  (ждёт 05 и 12).
- **06: Wave 4 → 6.** Wave 4 → 5: с 04 общий `harness/bin/tests/harness-home.test.sh`. Wave 5 → 6:
  с 05 тот же файл.
- **14: Wave 6 → 7.** По блокерам (последний — 12, Wave 5) — Wave 6. С 13 общий
  `test/contract/harness-install.test.ts`. Отсюда 15 — в Wave 8, 16 — в Wave 9.

Таблица собрана скриптом. Файлы — текст в обратных кавычках пунктов списка «Где в коде», без
пояснений после « — » и в скобках. Пересечения — правилом `filesOverlap`
(`src/shared/workflow/waves.ts:145`): папка с `/` на конце пересекается с каждым файлом в ней.
Внутри каждой Wave плана общих файлов нет, каждый блокер — в Wave раньше. Ticket 01 правит файлы
Ticket-ов в `.scratch/worfy-windows/issues`; в его списке их нет, а в Wave 1 он один.
