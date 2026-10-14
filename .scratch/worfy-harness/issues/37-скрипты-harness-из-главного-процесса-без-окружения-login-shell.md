# 37 — worfy, запущенный из Finder, не показывает Epic-и Silent Project-а: скрипты Harness из main process идут без окружения login shell, а сбой не виден в окне

Type: task
Status: open
Blocked by:
Source: приёмочный прогон 2026-10-14 под вторым пользователем macOS (приёмка E3, пункт 5, Ticket [26](26-приёмка-e3.md)); отчёт прогона — [../evidence/26-пункт-5-отчёт-2026-10-14.md](../evidence/26-пункт-5-отчёт-2026-10-14.md), находка 1 (блокер). Утверждения отчёта о коде сделаны по собранному `app.asar`; здесь они сверены с исходниками на main `ff61b06f` (2026-10-14).

## Что происходит

Слова, которые нужны дальше:

- **E3** — приёмка Epic-а `worfy-harness`. Её пункт 5 — ручной прогон под новым пользователем macOS.
- **Harness** — plugin Claude Code со скриптами в `harness/bin`. worfy запускает эти скрипты из main
  process (главный процесс Electron) и читает их ответ.
- **Profile** — файл `profile.json` с фактами о Project-е. Лежит в домашней папке Harness, вне
  репозитория. Его читает скрипт `profile`.
- **Реестр** — файл `gate/config.json` в домашней папке Harness: список подключённых Project-ов.
- **Full Project** — Project, у которого Ticket-ы лежат в репозитории: `<репозиторий>/.scratch`.
- **Silent Project** — Project, у которого Ticket-ы лежат вне репозитория, в Workflow folder. По
  умолчанию это `<домашняя папка Harness>/projects/<имя>/workflow`. Profile может назвать другую
  папку (`workflow.folder`). У Project-а над несколькими репозиториями это папка над ними
  (`harness/bin/profile:305-315`).
- **Раскладка** — ответ на вопрос «где у Project-а workflow»: режим, Workflow folder, корень
  Ticket-ов, репозитории. В коде — `ProjectLayout`.
- **Окружение login shell** — переменные, которые печатает `$SHELL -ilc`. worfy читает их один раз
  за запуск (`agentEnv()`, `src/main/agent/env.ts:516`). Причина записана в ADR-0007 (решение об
  окружении процесса Claude Code): у приложения, запущенного из Finder, PATH равен
  `/usr/bin:/bin:/usr/sbin:/sbin`, и node там нет.
- **First run** — экран первого запуска с проверками машины, 13 строк.

**Главное.** Пункт 5 приёмки E3 прошёл только с обходом: worfy запускали из Terminal.app, а не
двойным кликом, как велит инструкция. Пока этот Ticket не сделан, пункт 5 пройден с обходом.

### Что наблюдал прогон (по отчёту)

- 2026-10-14, 01:47–02:13, сборка main `ba8a58c`, пользователь macOS `worfy-test`. node стоит через
  nvm (v24.21.0).
- worfy запущен двойным кликом. First run: 13 строк из 13 зелёные. Silent Project `silent-app`
  подключён. Epic `e3-acceptance` положен в Workflow folder и закоммичен.
- В окне: «No epics in .scratch/» и «No epics yet». Перезапуск из Finder не помог.
- PATH живого процесса worfy: `/usr/bin:/bin:/usr/sbin:/sbin`.
- Команды из `~/silent-app` с `env -i HOME=$HOME PATH=/usr/bin:/bin:/usr/sbin:/sbin`:
  - `ticket root` → `env: node: No such file or directory`, exit code 127;
  - `epic-status --json` → `{"ref":"main","epics":[],"tickets":[]}`, exit code 0;
  - то же с каталогом nvm в PATH → Epic `e3-acceptance` и Ticket 01.
- Обход: Cmd+Q и запуск `~/Applications/worfy-stable.app/Contents/MacOS/worfy` из Terminal.app.
  Epic появился. Wave (один проход агентов по готовым Ticket-ам Epic-а) прошла.
- Контроль, 02:39–02:43, четыре запуска одной копии:
  - двойной клик в Finder — Epic-ов нет у обоих Project-ов;
  - `env -i HOME USER LOGNAME SHELL TMPDIR PATH=<nvm>:/usr/bin:/bin:/usr/sbin:/sbin open …` — те же
    14 переменных, отличается только PATH — Epic-и есть у обоих;
  - `open` из терминала передаёт приложению окружение терминала. Контролем служит только настоящий
    двойной клик.
- Wave при окружении Finder-а с node в PATH, 02:43–02:48. Процесс 80207:
  `PATH=<nvm>:/usr/bin:/bin:/usr/sbin:/sbin`, остальные переменные — как при двойном клике.
  «Autopilot» нажат в 02:44:20. Ticket 02 — `done`, журнал заканчивается строкой `run-stopped`.
  Вывод отчёта: кроме node в PATH main process, от окружения терминала ничего не нужно.

### Что подтверждено в исходниках (main `ff61b06f`)

**1. Как worfy получает окружение login shell и кто им пользуется.** `captureLoginShellEnv`
(`src/main/agent/env.ts:97-121`) запускает `$SHELL -ilc` из минимального окружения
(`:28-29`, `:38-45`) с таймаутом 10 секунд (`:35`). `agentEnv()` (`:513-522`) делает это один раз за
запуск приложения. Свой `process.env.PATH` приложение не меняет: присваиваний нет во всём `src/`.
Если shell упал или не уложился в 10 секунд, ответ — то же минимальное окружение с системным PATH
(`:103`, `:117`), а причина уходит в `console.warn` (`:518`).

Окружение login shell получают:

- Session-ы Claude Code — `src/main/agent/app-registry.ts:50`; черновик «Add project» —
  `src/main/ipc/projects.ts:94`;
- Terminal Node-ы (терминалы на Canvas) — `src/main/ipc/terminal.ts:211`, `:230`; Terminal AI
  (помощник в терминале) — `src/main/terminal-ai/assist.ts:710`;
- `gh` — `src/main/ipc/checks.ts:159`, `src/main/ipc/projects.ts:135`;
- проверки и действия First run — `src/main/ipc/first-run.ts:93`; qmd (поиск по документам) —
  `src/main/harness/qmd.ts:233`;
- часть вызовов скриптов Harness: `project-connect`, `qmd-collections` и `profile` для списка
  MCP-серверов, аккаунта GitHub, «Add project» и First run.

**2. Все запуски внешних программ из `src/main` и их окружение.** «login shell» в столбце
«Окружение» значит ответ `agentEnv()`.

Скрипты Harness:

| Где вызов | Что запускается | Окружение |
| --- | --- | --- |
| `src/main/workflow/reader.ts:107` (`runEpicStatus`; окружение — `:106`) | `epic-status --json`, `--json --ref <ветка>` | **`process.env`** + `HARNESS_HOME` |
| `src/main/workflow/folder.ts:88`, `:96` (`readProjectLayout`) → `src/main/workflow/profile.ts:78` | `profile -C <root> --json`, `ticket root` | **`process.env`**: умолчание `options.env ?? process.env` (`folder.ts:86`). Без `env` зовут `src/main/workflow/watch.ts:221`, `src/main/workflow/reader.ts:406` и общий cache `folder.ts:124`, созданный без `env` (`:134`) |
| `src/main/projects/store.ts:59` → `profile.ts:78` | `profile -C <папка> --json` | **`process.env`**, записано явно |
| `src/main/agent/app-registry.ts:39` → `profile.ts:78` | `profile --field mcp.allowed` | login shell (`app-registry.ts:50-51`) |
| `src/main/ipc/checks.ts:142` → `profile.ts:78` | `profile --field github.account` | login shell (`ipc/checks.ts:159`); `process.env`, когда задан `WORFY_GH` (test-ы) |
| `src/main/ipc/projects.ts:144` → `profile.ts:78` | `profile` для «Add project» | login shell |
| `src/main/ipc/first-run.ts:66` → `profile.ts:78` | `profile --name`, `--field qmd.collections` | login shell (`ipc/first-run.ts:96`, `:104`) |
| `src/main/ipc/projects.ts:69` | `project-connect` | login shell (`:66`) + `HARNESS_HOME` |
| `src/main/harness/qmd.ts:382` | `qmd-collections <project>` | login shell + `HARNESS_HOME` |

`HARNESS_HOME` добавляет `scriptEnv` (`src/main/harness/locate.ts:96-98`), у `qmd-collections` —
сам вызов.

Остальные программы:

| Где вызов | Что запускается | Окружение |
| --- | --- | --- |
| `src/main/agent/env.ts:106` | `$SHELL -ilc` | минимальное: системный PATH и восемь переменных из `process.env` |
| `src/main/first-run/checks.ts:83` | `claude`, `git`, `gh`, `node`, `jq` с `--version`; `gh auth status` | login shell |
| `src/main/first-run/actions.ts:81`, `src/main/harness/qmd.ts:183` | `npm`, `node`, `qmd` | login shell |
| `src/main/github/prs.ts:56-59` | `gh` | то, что дал вызывающий (`:54`): login shell; `process.env`, когда задан `WORFY_GH` (`src/main/ipc/checks.ts:158-159`, `src/main/ipc/projects.ts:134-135`) |
| `src/main/github/accounts.ts:219-224` | `/bin/sh -c 'exec "$0" auth login' gh` в pseudo-terminal | login shell; `process.env`, когда задан `WORFY_GH` |
| `src/main/harness/install.ts:583` | `claude` из сборки, по абсолютному пути | `process.env` (`src/main/ipc/harness.ts:21`, `:27`) |
| `src/main/terminal/pty.ts:767` (`spawnShellPty`, `:388-390`) | shell Terminal Node-а в pseudo-terminal (node-pty) | login shell (`src/main/ipc/terminal.ts:211`, `pty.ts:742`) |
| Agent SDK, функция `query`: `src/main/agent/app-registry.ts:67`, `src/main/ipc/projects.ts:109`, `src/main/terminal-ai/assist.ts:463`; проверка входа First run — `src/main/ipc/first-run.ts:50-52` | Claude Code из сборки | login shell (`app-registry.ts:50`, `ipc/projects.ts:94`, `assist.ts:710`) |
| `src/main/projects/store.ts:44`, `src/main/workflow/reader.ts:284`, `src/main/workflow/watch.ts:141`, `src/main/gate/state.ts:385`, `src/main/ipc/shell.ts:13`, `src/main/ipc/autopilot.ts:65`, `src/main/autopilot/origin.ts:53`, `src/main/autopilot/harness-drift.ts:65`, `src/main/terminal-ai/git-branch.ts:17`, `src/main/harness/migrate/apply.ts:139`, `src/main/harness/migrate/profiles.ts:139`, `src/main/claude-home/registry.ts:98` (`git -C <root> worktree list --porcelain`, `process.env` без четырёх переменных `GIT_*`, `:96`) | `git` по имени | `process.env` (местами без переменных `GIT_*`) |
| `src/main/claude-home/registry.ts:248` | `ps` | `process.env` |
| `src/main/agent/env.ts:267`, `src/main/terminal/pty.ts:322` | Windows PowerShell, только на Windows | `process.env` |

`src/main/harness/migrate/restore.ts:296` и `:372` — текст отдельного скрипта `restore.mjs`
(`:93`), main process его не выполняет.

**3. Список Epic-ов.** `runEpicStatus` берёт `scriptEnv(harness, process.env)`
(`src/main/workflow/reader.ts:102-107`). Параметра окружения нет ни у него, ни у
`epicStatusRunner` (`:85`). Этот runner зовут наблюдатель за файлами workflow
(`src/main/workflow/watch.ts:218`), `readWorkflow` (`reader.ts:402`) и MCP-сервер Canvas — сервер,
через который Session видит холст (`src/main/mcp/canvas-server.ts:421`).

**4. Что делает `epic-status` без node.** Скрипт на bash. Корень Ticket-ов он спрашивает у соседа
`ticket root`, но только если `command -v node` находит node (`harness/bin/epic-status:58-59`).
Без node он `ticket root` не зовёт вовсе. Он берёт `<git top-level или текущая папка>/.scratch`
(`:62-64`). Это задумано: комментарий `:55` — «Without node — the old behaviour». Если такой папки
нет, `--json` печатает пустые списки и выходит с exit code 0 (`:180`, `:320`). С `--ref` без node
скрипт не спрашивает режим Project-а (`:283`) и тоже отвечает пустым списком.

Когда node есть, а `ticket root` падает, `epic-status` выходит с его exit code (`:59`,
`|| exit $?`). Сам `ticket root` при сломанном Profile-е отказывает с exit code 1
(`harness/bin/ticket:126-132`).

**5. Где worfy теряет режим Silent.** `readProjectLayout` (`src/main/workflow/folder.ts:84-100`)
запускает `profile -C <root> --json`. При любом ответе «нет» он пишет строку
`[workflow] <root>: Full mode, the workflow files in the Project root, because <причина>`
(`:90`) и возвращает раскладку Full: режим `full`, Ticket-ы в `<root>/.scratch`, список
репозиториев пуст (`:91`, `:41-44`). `ticket root` (`:96`) в этом случае не запускается.

Ответ «нет» — это каждый из случаев `src/main/workflow/profile.ts`:

- скрипта нет (`:134`); скрипт не запустился (`:135`);
- exit code 3 — папка не в зарегистрированном Project-е (`:139`);
- exit code 4 — «в Profile-е нет такого поля»; на `--json` скрипт так отвечать не должен, поэтому
  это тоже отказ (`:140`); таймаут 15 секунд (`:141`, `:57`);
- любой другой exit code, не 0 (`:142`) — сюда попадает 127 («нет node»);
- вывод не JSON (`:259`); Harness старше Silent mode (`:262`); не те поля (`:266`).

Причина видна только в консоли: `logOnce` пишет её в `console.warn` один раз на Project и причину
(`folder.ts:64-68`). Она же лежит в поле `ProjectLayout.reason` (`:37`), но это поле никто не
читает. Наблюдатель читает раскладку один раз, при старте (`watch.ts:12`, `:221`), и следит за
`<root>/.scratch` (`:288`). У Silent Project-а такой папки нет.

**6. Что показывает окно.** `epic-status` ответил пустым списком с exit code 0, поэтому в модели
нет ошибки. Боковая панель пишет «No epics in .scratch/»
(`src/renderer/shell/sidebar/EpicsSection.tsx:55`), Canvas — «No epics yet»
(`src/renderer/canvas/overlays/FirstEpic.tsx:21`, `:64`). Канал для ошибки уже есть: текст
`model.error.message` показывается в боковой панели (`EpicsSection.tsx:54`), и панель «No epics
yet» при ошибке скрыта (`FirstEpic.tsx:21`).

**7. Почему First run зелёный.** Экран получает окружение login shell
(`src/main/ipc/first-run.ts:96-98`). С ним идут десять строк из 13
(`src/main/first-run/checks.ts:131-145`): вход, инструменты (`checks.ts:83`, строка node —
`checks.ts:250`) и три строки qmd. Строки «Harness plugin» и «Plugin dependencies» читают состояние
установщика (`ipc/first-run.ts:101`). Установщик запускает `claude` из сборки по абсолютному пути с
`process.env` (`src/main/harness/install.ts:406`, `:583`) и скрипт Harness не запускает. Строка
«Old Harness in ~/.claude» только читает файлы (`checks.ts:316-319`). Строка «qmd collections» запускает `profile`, но тоже с окружением login
shell (`ipc/first-run.ts:65-66`), а его отказ читает как «Profile-а нет» и остаётся зелёной
(`checks.ts:358`). Ни одна строка не запускает скрипт Harness так, как его запускает чтение
Epic-ов.

**8. Почему автоматическая приёмка этого не обнаружила.**

- `test/acceptance/e3.spec.ts:225-227` запускает бинарник приложения напрямую и отдаёт ему
  окружение песочницы. PATH песочницы — `<песочница>/npm/bin:<песочница>/tools:` и системные папки
  (`scripts/e3-sandbox.sh:109`, `:161`). В `tools/` лежит ссылка на node машины (`:89`,
  `:126-148`). У main process в приёмке node есть в собственном PATH.
- e2e (`test/e2e/helpers.ts:133-153`, `:160-164`) отдаёт приложению всё окружение процесса test-а.
  Там node есть.
- e2e Silent Project-а (`test/e2e/silent-project.spec.ts:95-112`) подменяет `profile`, `ticket` и
  `epic-status` скриптами на `/bin/sh` (`:108`). Им node не нужен.
- Contract test «скрипт идёт с переданным окружением, а не с окружением worfy» есть только для
  списка MCP-серверов (`test/contract/workflow-profile.test.ts:214-224`).
- Test-ы `readProjectLayout` в `test/contract/workflow-profile.test.ts` передают `env` сами
  (`:417`, `:437`, `:442`, `:460`, `:500`). Умолчание `process.env` проходят другие test-ы: Silent
  Project в `test/contract/workflow-reader.test.ts:516-532` (`readWorkflow` без `env`, `:523`) и
  test cache в `test/contract/workflow-profile.test.ts:475`. Но их `profile` и `ticket` — скрипты
  на `/bin/sh` (`workflow-reader.test.ts:479`, `:482`), а в test-е cache скрипта нет вовсе.
  Интерпретатор из PATH им не нужен. Случая «скрипту нужен node, а в `process.env.PATH` его нет»
  нет ни в одном test-е.

**9. Почему дефекта не видно на учётной записи владельца.** Оба ответа без node указывают на
`<репозиторий>/.scratch`: `epic-status` (`harness/bin/epic-status:62-64`) и раскладка Full
(`folder.ts:43`). У Full Project-а с `tickets.root` `.scratch/` этот ответ совпадает с правдой
случайно. Оба Project-а в приложении владельца такие; замеры — в подразделе «Что замерено на
машине владельца».

### Что замерено на машине владельца (не исходники)

- Процесс `worfy-stable.app` владельца, запущен 2026-10-13 21:35:18:
  `PATH=/usr/bin:/bin:/usr/sbin:/sbin` по `ps eww`. `command -v node` с этим PATH — exit code 1.
  Замер Session, которая ведёт приёмку; повторён при проверке черновика 2026-10-14.
- В списке Project-ов приложения два Project-а: репозиторий worfy и Auction. У их Profile-ов
  `worfy` и `auction` `mode` — `full`, `tickets.root` — `.scratch/` (прочитано `jq`, только
  чтение).
- Третий Profile владельца, `atakama`, — `silent`. В список Project-ов приложения он не входит.

### Что воспроизведено в песочнице

Песочница — временная папка: git-репозитории, свой `HOME`, свой `HARNESS_HOME` с реестром и
Profile-ами. Скрипты — из worktree на `ff61b06f`. Общий вид команды:
`cd <репозиторий> && env -i HOME=<песочница>/home HARNESS_HOME=<…>/worfy-harness PATH=<PATH> <worktree>/harness/bin/<скрипт> …`.
«Системный PATH» — `/usr/bin:/bin:/usr/sbin:/sbin`. node — v24.19.0 из nvm.

| Репозиторий | PATH | Команда | Ответ | exit code |
| --- | --- | --- | --- | --- |
| Silent, без `.scratch` | системный | `ticket root` | `env: node: No such file or directory` | 127 |
| Silent | системный | `profile -C <репозиторий> --json` | `env: node: No such file or directory` | 127 |
| Silent | системный | `epic-status --json` | `{"ref":"main","epics":[],"tickets":[]}` | 0 |
| Silent | системный | `epic-status` | `outside tickets (no <репозиторий>/.scratch)` | 0 |
| Silent | системный | `epic-status --json --ref main` | `{"ref":"main","epics":[],"tickets":[]}` | 0 |
| Full, `.scratch/demo/issues/01-x.md` | системный | `epic-status --json` | Epic `demo`, Ticket 01 | 0 |
| Silent | с node | `ticket root` | `<Workflow folder>/.scratch` | 0 |
| Silent | с node | `epic-status --json` | Epic `e3-acceptance`, Ticket 01 | 0 |
| Silent | с node | `epic-status --json --ref main` | отказ «in Silent mode the status does not live in branches…» | 3 |
| Profile сломан (`{"schema": 2}`) | с node | `epic-status --json` | `project profile not read (…, exit 1): …` | 1 |
| Profile сломан | системный | `epic-status --json` | `{"ref":".","epics":[],"tickets":[]}` | 0 |
| папка вне git, реестра нет | с node | `ticket root` | `project profile not read (…): profile: resolver … failed (exit 4)` | 1 |
| папка вне git, реестра нет | с node | `profile --help` | строка usage | 0 |
| папка вне git | системный | `profile --help` | `env: node: No such file or directory` | 127 |

Приложение, e2e и сборка не запускались.

### Поправки к отчёту

- Отчёт: «`epic-status` при сбое `ticket root` отвечает пустым списком и кодом 0». По исходникам
  иначе. Без node `epic-status` не зовёт `ticket root` (`harness/bin/epic-status:58`) и нарочно
  берёт `<репозиторий>/.scratch` (`:55`, `:62-64`). При сбое `ticket root` он выходит с его exit
  code (`:59`; воспроизведено: 1). Дефект есть, но это ветка «нет node».
- Отчёт: «`profile --json` и `ticket root` тоже идут с `process.env`». `ticket root` из
  `readProjectLayout` при PATH Finder-а не запускается: `profile --json` падает раньше, и функция
  выходит (`folder.ts:89-92`).
- Отчёт: окружение login shell не получают «вызовы скриптов Harness-а из главного процесса».
  Не получают три группы вызовов: `epic-status`; `profile --json` и `ticket root` из
  `readProjectLayout`; `profile --json` из `src/main/projects/store.ts:59`. Остальные получают.
- Отчёт: `readProjectLayout` «молча переходит на раскладку Full», а строка `[workflow] …` «уходит
  в консоль, которую при запуске из Finder не видно». Это верно. Уточнения по исходникам: строка
  пишется один раз на Project и причину (`folder.ts:64-68`); переход случается при любом ответе
  «нет», не только при 127 (`src/main/workflow/profile.ts:134-142`, `:259-266`).
- Отчёт: «исправление сводится к одному» — передать окружение. Этого мало. `agentEnv()` сам может
  вернуть системный PATH (`env.ts:103`, `:117`). Тогда остаются оба ответа без ошибки: пустой
  список от `epic-status` без node и раскладка Full после неудачного вызова `profile`.

### Что остаётся предположением

- На Mac, где node стоит через Homebrew или официальный установщик, будет то же: `/opt/homebrew/bin`
  и `/usr/local/bin` не входят в системный PATH (`env.ts:29`). На другом Mac не проверялось.
- Silent Project над несколькими репозиториями (у владельца такой Profile есть — `atakama`) под PATH
  Finder-а, по коду, читается как Full с пустым списком репозиториев. В окне не проверялось.
- `env -i … PATH=/usr/bin:/bin:/usr/sbin:/sbin open <app>` даёт приложению то же окружение, что
  двойной клик. Отчёт запускал этот вид команды только с nvm в PATH. Этот способ уже записан в
  Harness как запуск «как из Finder»: `harness/skills/ship-ticket/SKILL.md:229-232`.

## Что делаем

### 1. Скрипты Harness из main process получают окружение login shell

Сейчас с `process.env` идут три группы вызовов: `epic-status`; `profile --json` и `ticket root` из
`readProjectLayout`; `profile --json` из `harnessWorkspaceOf`. Они получают то же окружение, что
уже получают `project-connect` и `qmd-collections`: ответ `agentEnv()` плюс `HARNESS_HOME`.

Что меняется:

- `src/main/workflow/reader.ts` — `epicStatusRunner` и `runEpicStatus` принимают окружение
  (`:85`, `:102-107`); `readWorkflow` передаёт его и в runner, и в `readProjectLayout` (`:402`,
  `:406`).
- `src/main/workflow/folder.ts` — у `readProjectLayout` нет умолчания `process.env` (`:52`, `:86`);
  общий cache получает окружение (`:134`).
- `src/main/workflow/watch.ts` — наблюдатель передаёт окружение в runner и в раскладку (`:218`,
  `:221`).
- `src/main/projects/store.ts:59` — `harnessWorkspaceOf`.
- Места, где приложение собирает эти части: `src/main/ipc/workflow.ts:10`,
  `src/main/ipc/autopilot.ts:103`, `src/main/ipc/actions.ts:41`,
  `src/main/mcp/canvas-server.ts:421`.

Как именно — выбор:

- **(а) Рекомендуем.** Одна функция «окружение скриптов Harness» (например, в
  `src/main/harness/`). Её зовут все места сборки и новая строка First run, которая запускает
  скрипт Harness. Параметр окружения у `epicStatusRunner`, `readProjectLayout`, `LayoutCache`,
  `WorkflowHub` и `readWorkflow` — обязательный, без умолчания. Компилятор покажет каждое место
  вызова. Дефект появился как раз из необязательного параметра с умолчанием `process.env`.
- **(б)** Один общий runner для всех скриптов Harness вместо четырёх мест запуска
  (`reader.ts:107`, `profile.ts:78`, `ipc/projects.ts:69`, `qmd.ts:382`). Правка больше, а те же
  места перепишет Ticket `worfy-windows/05` (перевод `epic-status` на Node и вызов скриптов через
  `node <файл>`). Здесь не делаем.

Это меняет решение из Ticket-а [23](23-worfy-читает-silent-project-и-несколько-репозиториев.md)
(worfy читает Silent Project), раздел «Итог», пункт (2): «окружение `profile` и `ticket` для
чтения режима — то же, что у `epic-status` (окружение процесса worfy)». Владелец подтвердил его
2026-10-12. Прогон 2026-10-14 показал, что оно ломает Silent Project при запуске из Finder.
Смена решения — слово владельца, до merge.

### 2. `epic-status` без node отказывает, а не отвечает пустым списком

Нет node в PATH и не дан `--root`: `epic-status` пишет причину в stderr и выходит с exit code,
отличным от 0. Текст называет node и PATH. Рекомендуем exit code 3: этим кодом скрипт уже говорит
«прочитать не могу, а не пусто» (`harness/bin/epic-status:284-285`, `:290-291`). Это касается всех
трёх видов вызова: `--json`, `--json --ref` и строки без флагов (`:194`).

С `--root <папка>` node не нужен (`:60-61`) — эта ветка остаётся.

В самом Harness без node не работает ни один вызывающий: `preflight` зовёт `profile` и `node -e`
(`harness/bin/preflight:148`, `:154`), `epic-board` — скрипт на node. Test-а на ветку «нет node» в
`harness/bin/tests` нет.

worfy для этого менять не нужно: exit code, отличный от 0, уже становится ошибкой модели с текстом
из stderr (`src/main/workflow/reader.ts:114-115`), и окно её показывает.

### 3. Неудачный вызов `profile` виден в окне, а не подменяется раскладкой Full

`readResolvedProfile` (`src/main/workflow/profile.ts:252-270`) различает два вида ответа «нет»:

- **Profile-а нет** — раскладка Full, как сейчас: exit code 3 (`:139`), скрипта нет (`:134`),
  Harness старше Silent mode (`:262`).
- **Вызов не удался** — режим неизвестен: любой другой exit code (127 — нет node; 1 — сломан
  реестр или `profile.json`), таймаут, вывод не JSON, не те поля, exit code 4 на `--json`, скрипт
  не запустился.

Для второго вида — выбор:

- **(а) Рекомендуем.** Раскладка не угадывается. Модель Project-а пустая, с ошибкой и причиной —
  тем же путём, что при упавшем `epic-status` (`src/main/workflow/reader.ts:271-279`). Боковая
  панель показывает текст, панель «No epics yet» скрыта, renderer не меняется. Так уже ведёт себя
  сломанный Profile: при exit code 1 от `profile` падает `ticket root`, за ним `epic-status`
  (воспроизведено).
- **(б)** Раскладка Full остаётся, а рядом со списком Epic-ов появляется строка-предупреждение.
  Нужно новое поле в модели (`src/shared/workflow/types.ts:77-85`) и новый текст в renderer.

В обоих вариантах: после устранения причины состояние уходит без перезапуска приложения. Сейчас
наблюдатель читает раскладку один раз при старте (`watch.ts:12`), а общий cache держит ответ 30
секунд (`folder.ts:105`, `:123`). Как раскладка перечитывается после неудачи — решить при работе и
записать в «Итог».

### 4. Строка First run запускает скрипт Harness так, как его запускает main process

- **(а) Рекомендуем: новая строка** в группе «Harness», после «Plugin dependencies». Она запускает
  `profile --help` тем же runner-ом (`harnessScriptRunner`, `profile.ts:72`) и с окружением из той
  же функции, что чтение Epic-ов, а не с `deps.env` экрана. `--help` не читает реестр
  (`harness/bin/profile:97-100`): без файла реестра он отвечает exit code 0, а `ticket root` там
  же — 1 (воспроизведено).
  - exit code 0 — `ok`;
  - любой другой или скрипт не запустился — `fail`: exit code, последняя строка stderr, подсказка,
    что worfy не может запустить скрипты Harness;
  - plugin не установлен — строка не красная и говорит, что проверка идёт после установки, как
    «Plugin dependencies» (`src/main/first-run/checks.ts:308-311`).
- **(б)** Расширить строку «Harness plugin». Не рекомендуем: её состояния и кнопки — про установку.

Новая строка меняет число проверок с 13 на 14: `src/shared/ipc/first-run.ts:14-29`,
`checks.ts:131-145`, `:399-413`, `test/acceptance/e3.spec.ts:47`, `test/e2e/first-run.spec.ts:113`,
`test/contract/first-run-checks.test.ts:120-134` (порядок всех строк) и `:277` (строки группы
«Harness»). First run открывается сам, когда
красной стала проверка, которая не была красной при закрытии экрана
(`src/main/ipc/first-run.ts:6-11`): человек с этим дефектом увидит экран при следующем запуске.

### 5. Приёмка и e2e запускают приложение с PATH Finder-а

- `test/acceptance/e3.spec.ts:226` — приложение получает PATH `/usr/bin:/bin:/usr/sbin:/sbin`.
  Инструменты оно находит через login shell песочницы: `scripts/e3-sandbox.sh` пишет её PATH в
  `home/.zshenv` и `home/.profile` (`:173-180`, `:248-252`). Команды самого test-а (`git`, `gh`,
  скрипты Harness) идут с окружением песочницы, как сейчас.
- Новый e2e собранного приложения с тем же PATH — первый пункт «Готово, когда».

### Порядок работы: два PR (решение оркестратора, 2026-10-14)

- **Срез 1 — снимает блокер приёмки.** Пункт 1. Из «Готово, когда»: первый e2e (Epic Silent
  Project-а виден при PATH Finder-а), contract test, первые три мутанта, замер времени e2e. После
  merge пакет в `/Users/Shared/worfy-item5/` собирается заново, и владелец делает ручную проверку.
- **Срез 2 — сбой виден.** Пункты 2, 3, 4 и 5 и остальные строки «Готово, когда».
- Ticket закрывается вторым срезом.

Почему так. Владелец 2026-10-14 ждёт быстрый фикс для повторной проверки: «Е3 пока не закрываем,
фикс выглядит простым и быстрым, я проверю». Пункты 2–4 меняют поведение Full Project-ов и число
строк First run; по ним нужно его слово (раздел «Риски»).

О решении из Ticket-а 23. Слова владельца сказаны после чтения отчёта прогона, который предлагает
передать скриптам окружение login shell. Оркестратор считает их согласием на пункт 1. Это
толкование оркестратора; прямой вопрос владельцу задан 2026-10-14, ответ — в «Итог».

## Готово, когда

- [x] e2e, собранное приложение, новый случай. PATH приложения — `/usr/bin:/bin:/usr/sbin:/sbin`.
      node — только в PATH login shell (`SHELL=/bin/sh`, временный `HOME`, `.profile`). Harness —
      настоящие скрипты из `out/harness`, установленные как plugin. Project — Silent, Epic лежит в
      Workflow folder до запуска приложения. В боковой панели есть строка Epic-а, на Canvas — его
      рамка. **На нынешнем main красный: «No epics in .scratch/».**
      Доказано: `test/e2e/finder-path.spec.ts:98` — зелёный на сборке ветки среза 2 (2026-10-14, 12 passed вместе с First run, Silent Project и Health); красный на main до среза 1 — в PR #305.
- [x] Тот же e2e, node нет и в login shell: боковая панель показывает причину со словом node,
      панели «No epics yet» нет. На нынешнем main — «No epics in .scratch/» и панель.
      Доказано: `test/e2e/finder-path.spec.ts:122` — на сборке main `4d70e689` красный (текста причины нет, `element(s) not found`), на сборке ветки зелёный; в окне: «worfy could not ask the Harness where the workflow of this Project lives: the profile script failed with exit code 127: env: node: No such file or directory».
- [x] Contract test: `process.env.PATH` без node, окружение, отданное чтению, с node. Настоящие
      `epic-status`, `ticket`, `profile`. Модель несёт Epic и Ticket Silent Project-а; раскладка —
      `silent`, корень Ticket-ов — в Workflow folder. То же для `harnessWorkspaceOf`. На нынешнем
      main красный.
      Доказано: `test/contract/harness-script-env.test.ts`, 8 из 8 (срез 1, PR #305).
- [x] `harness/bin/tests`: без node в PATH и без `--root` команды `epic-status --json`,
      `epic-status` и `epic-status --json --ref main` выходят с exit code, отличным от 0, и
      называют node в stderr. С `--root <папка>` без node — exit code 0, как раньше. На нынешнем
      main — exit code 0 и пустой ответ.
      Доказано: `harness/bin/tests/tickets-root.test.sh`, раздел 8 — на `origin/main` три случая красные (exit code 0, ответ из `<репозиторий>/.scratch`), на ветке 26 passed, 0 failed.
- [x] Раскладка: таблица случаев `test/contract/workflow-profile.test.ts:447-468` разделена на
      «Profile-а нет» (Full, как раньше) и «вызов не удался» (модель с причиной либо
      предупреждение — по выбранному варианту); случай exit code 127 добавлен. Test на модель: при
      неудачном вызове `profile` окно получает причину.
      Доказано: `test/contract/workflow-profile.test.ts` — «no Profile — …» (3 случая) и «a failed call — …» (18 случаев после раунда 2 ревью, среди них 127, 126, сигнал и ошибки запуска), «readWorkflow: the script finds no interpreter (exit code 127)…»; на исходниках main 17 красных; после раунда 2 ревью в файле 85 test-ов, все зелёные.
- [x] После устранения причины Epic-и появляются без перезапуска приложения; как — в «Итог».
      Доказано (ревью PR #311, раунд 1): `test/contract/harness-script-env.test.ts`, «the app's own source: node added to the login shell's .profile after the start shows the Epics without a restart, and a Ticket written after that shows too» — настоящий источник окружения приложения, настоящие скрипты, `SHELL=/bin/sh`, `.profile` в песочнице без node, затем с node; на исходниках head `57e9422a` красный («not within 20000 ms: the Epic after node was added»). Как — в «Итог», «Ревью, раунд 1».
- [x] First run: новая строка. Contract test — три состояния. e2e — при PATH приложения без node и
      login shell с node строка зелёная; при login shell без node — красная, с exit code 127.
      Доказано: `test/contract/first-run-checks.test.ts`, describe «the Harness scripts row» (после раунда 2 ревью — 12 test-ов: Harness не установлен, OK, нет node с 127 и с 126, нет скрипта, timeout и его предел 15 s, сигнал, падение скрипта, скрипт не запускается, Windows); e2e `test/e2e/first-run.spec.ts:292` — зелёная строка при PATH приложения без node, красная с «exit code 127» без node в login shell; на сборке main красный (13 строк вместо 14).
- [ ] `test/acceptance/e3.spec.ts` запускает приложение с системным PATH.
      Не отмечено: в срезе 2 spec запускает приложение с `PATH: FINDER_PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`) и ждёт строку «Harness scripts» в состоянии OK; проверены только компилятор и eslint, приёмка не запускалась (бриф запрещает).
- [x] Мутанты (нарочно испорченный код, на котором test обязан стать красным), каждый красный:
      «`runEpicStatus` снова берёт `process.env`»; «`readProjectLayout` снова берёт
      `process.env`»; «`harnessWorkspaceOf` снова берёт `process.env`»; «`epic-status` без node
      снова отвечает `<репозиторий>/.scratch`»; «неудачный вызов `profile` снова даёт Full без
      причины»; «строка First run берёт окружение экрана, а не общее».
      Доказано: первые три — срез 1 (PR #305); остальные три — таблица в «Итог», срез 2 (M1, M2, M3).
- [ ] (вручную, владелец) Второй пользователь macOS, сборка с этим Ticket-ом. Silent Project
      подключён, Epic положен в Workflow folder и закоммичен. После этого worfy закрыт (Cmd+Q) и
      открыт настоящим двойным кликом в Finder. `ps eww <pid>` показывает PATH
      `/usr/bin:/bin:/usr/sbin:/sbin`. Silent Project показывает свой Epic в боковой панели и на
      Canvas. Перезапуск нужен: в том же прогоне (02:27–02:36) Epic, положенный после подключения
      Silent Project-а, не появился до повторного открытия Project-а, хотя node в PATH был. Это
      отдельная находка — Ticket 41 этого Epic-а, она вне скоупа. `open` из терминала контролем
      не считается. Ответ — в «Итог» Ticket-а 26, пункт 5.
      Не отмечено: проверка владельца, после merge.
- [ ] Слово владельца о смене решения из Ticket-а 23 записано в «Итог».
      Не отмечено: это запись оркестратора.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit code 0; gate full (полная проверка перед
      merge) на Mac зелёный.
      Не отмечено: `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit code 0 (срез 2, ниже); gate full — дело оркестратора перед merge.

## Тесты

- **Сначала красный e2e.** Образец окружения — `test/e2e/first-run.spec.ts:52-90`: временный
  `HOME`, `SHELL=/bin/sh`, `.profile` ставит в PATH свою папку. В этой папке — ссылка на настоящий
  node (`process.execPath` процесса Playwright). `launchApp` копирует всё окружение test-а
  (`test/e2e/helpers.ts:133-136`), поэтому PATH приложения test задаёт сам, через `options.env`.
  Harness — копия `out/harness` в `<Claude home>/worfy-harness/plugin`; реестр, Silent Profile и
  Workflow folder — во временных папках. Строка Epic-а — `data-testid="sidebar-epic"`
  (`src/renderer/shell/sidebar/EpicsSection.tsx:67-68`).
- **Contract test.** Образец «интерпретатор только в PATH login shell» —
  `test/contract/workflow-profile.test.ts:112-124`. `pnpm test` идёт под Node из Electron
  (`scripts/vitest-electron.mjs:24-27`), `process.execPath` там — Electron. Настоящий node test
  находит через `command -v node`, как `test/contract/harness-scripts.test.ts:41-44`. PATH «без
  node» для `process.env` test собирает сам: папка со ссылками на утилиты, которые нужны
  `epic-status` (среди них `bash`, `git`, `awk`, `xargs`, `realpath`, `dirname`, `sed`, `tr`), без
  node — как в `harness/hooks/tests/gate-verdict.test.sh:135-145`. `pnpm test` идёт в CI на Linux
  (`.github/workflows/ci.yml:26`, `:49`), а там node может лежать в системной папке. Test сам
  проверяет, что `command -v node` с этим PATH ничего не находит.
- **Shell-test «нет node».** PATH — папка со ссылками на нужные утилиты без node, как в
  `harness/hooks/tests/gate-verdict.test.sh:135-145`. `PATH=/usr/bin:/bin` не годится: на другой
  машине node может лежать в `/usr/bin`.
- **Существующие test-ы, которые изменятся.**
  - `test/contract/workflow-profile.test.ts:447-468` закрепляет нынешнее поведение: любой отказ
    `profile` — раскладка Full.
  - `test/contract/workflow-reader.test.ts` передаёт stub-у данные через `process.env`
    (`STUB_LOG`, `:27`). Этим test-ам отдать runner-у `process.env` явно.
  - `test/fixtures/first-run-tools/node:4-9` — подставной node умеет только `--version`. С новой
    строкой First run он должен уметь запустить скрипт, иначе e2e First run станет красным.
- **Замер e2e.** Сейчас e2e-приложение читает Epic-и без login shell. После правки каждый старт с
  открытым Project-ом ждёт `$SHELL -ilc` машины, на которой идут test-ы. В `test/e2e` 209 вызовов
  `test(`. Замерить время `pnpm test:e2e` до и после, числа — в «Итог».
- Ни один test не пишет в настоящие `~/.claude`, `~/.config` и `~/Library`.

## Где в коде

- `src/main/workflow/reader.ts` — `epicStatusRunner` `:85`, `runEpicStatus` `:102-118`,
  `readCheckout` `:271-280`, `readWorkflow` `:400-412`.
- `src/main/workflow/folder.ts` — `fullLayout` `:41-44`, `logOnce` `:64-68`, `readProjectLayout`
  `:84-100`, cache `:114-136`.
- `src/main/workflow/profile.ts` — `harnessScriptRunner` `:72-87`, `runProfile` `:124-144`,
  `readResolvedProfile` `:252-270`.
- `src/main/workflow/watch.ts` — `WorkflowWatcher.start` `:216-234`, чтение `:331-355`.
- `src/main/harness/locate.ts` — `scriptEnv` `:96-98`.
- `src/main/agent/env.ts` — `agentEnv` `:513-522`.
- `src/main/projects/store.ts` — `harnessWorkspaceOf` `:58-61`.
- `src/main/ipc/workflow.ts:10`, `src/main/ipc/autopilot.ts:103`, `src/main/ipc/actions.ts:41`,
  `src/main/mcp/canvas-server.ts:421`, `src/main/ipc/checks.ts:52`, `src/main/ipc/docs.ts:25`.
- `src/main/first-run/checks.ts`, `src/main/ipc/first-run.ts`, `src/shared/ipc/first-run.ts`.
- `src/shared/workflow/types.ts` — ошибка модели `:66-71`, модель `:77-85`.
- `src/renderer/shell/sidebar/EpicsSection.tsx:52-55`,
  `src/renderer/canvas/overlays/FirstEpic.tsx:19-22`.
- `harness/bin/epic-status` — выбор корня `:54-66`, `--ref` `:278-286`.
- `harness/bin/tests/tickets-root.test.sh`, `harness/bin/tests/silent-mode.test.sh`.
- `test/contract/workflow-reader.test.ts`, `test/contract/workflow-profile.test.ts`,
  `test/contract/first-run-checks.test.ts`.
- `test/e2e/silent-project.spec.ts`, `test/e2e/first-run.spec.ts`, `test/e2e/helpers.ts`,
  `test/fixtures/first-run-tools/node`.
- `test/acceptance/e3.spec.ts` — `launch` `:225-244`, `CHECK_IDS` `:47`.

## Вне скоупа

- Перевод `epic-status` на Node и вызов скриптов через `node <файл>` — Ticket `worfy-windows/05`
  (скрипты `harness/bin` на Node). Его пункт 5 уже требует отдать `epic-status` окружение агента,
  а пункт 1 убирает ветку «нет node». Раскладку (`readProjectLayout`), видимость сбоев и строку
  First run он не покрывает. Его фраза «Сегодня это не мешает: bash-версия обходится без node»
  (строки 51–53 его файла) для Silent Project-а неверна. Этот Ticket делается раньше: он устраняет
  блокер приёмки.
- `git` из main process идёт с `process.env` (например, `src/main/workflow/reader.ts:284`,
  `src/main/projects/store.ts:44`). На Mac прогона `/usr/bin/git` есть: в песочнице `git` под
  системным PATH отработал. Mac без Command Line Tools не проверялся.
- Текст «No epics in .scratch/» у Silent Project-а называет не ту папку (`EpicsSection.tsx:55`).
- MCP-сервер Canvas читает модель без корня Ticket-ов (`src/main/mcp/canvas-server.ts:421`), и
  заголовки Epic-ов ищутся в `<root>/.scratch` (`src/main/workflow/reader.ts:225`). Замечено при
  чтении кода, запуском не проверено.
- Машина с plugin-ом, но без реестра `gate/config.json`: `profile` отвечает exit code 1, а не 3
  (воспроизведено). Что после этого Ticket-а видно в окне — в «Риски».
- Остальные находки отчёта (2–9) и наблюдатель за `.scratch`, созданной после подключения.
- Текст инструкции прогона `/Users/Shared/worfy-item5/README-item5.md`.

## Риски

- **`agentEnv()` может вернуть системный PATH.** Shell упал или не уложился в 10 секунд
  (`src/main/agent/env.ts:103`, `:117`) — node снова нет. Поэтому отказ `epic-status`, причина в
  окне и строка First run нужны и после передачи окружения.
- **Harness на машине старше приложения.** Правка `epic-status` действует после обновления
  plugin-а (First run → Update; у владельца — `pnpm install:stable`). До этого на машине стоит
  прежний скрипт. Причина в окне при неудачном вызове `profile` не должна зависеть от новой версии
  `epic-status`.
- **Первое чтение Epic-ов ждёт login shell.** Сейчас оно его не ждёт. Медленные rc-файлы задержат
  появление Epic-ов на время до 10 секунд.
- **e2e начинают зависеть от login shell машины.** Число для решения — замер времени
  `pnpm test:e2e` до и после. Если время или нестабильность заметны, выбор: `launchApp` задаёт свой
  `HOME` и `SHELL=/bin/sh`, либо переменная только для test-ов, как `WORFY_GH`
  (`src/main/ipc/checks.ts:159`). Такая переменная не должна действовать в приёмке E3.
- **Передача окружения сама меняет поведение там, где `profile` отвечает exit code 1.** Пример —
  машина с plugin-ом, но без файла реестра `gate/config.json`. С node в PATH `epic-status` зовёт
  `ticket root`, тот зовёт `profile`. `profile` выходит с exit code 1: реестр не прочитан
  (`harness/bin/profile:139-147`, `harness/hooks/gate-resolve.mjs:41-46`). `ticket root` на любой
  exit code, кроме 3, отказывает с exit code 1 (`harness/bin/ticket:126-131`), и `epic-status`
  выходит с ним же. Воспроизведено в песочнице: Full-репозиторий с `.scratch/demo/issues/01-x.md`,
  `HARNESS_HOME` без `gate/config.json`. PATH с node — `project profile not read (…, exit 1):
  profile: resolver … failed (exit 4)`, exit code 1. Системный PATH — Epic `demo` и Ticket 01, exit
  code 0. Сегодня worfy из Finder показывает Epic-и такого Project-а, а worfy из терминала уже
  показывает ошибку. После пункта 1 ошибку покажет и worfy из Finder — раньше, чем сделан пункт 3.
  Project попадает в список и без реестра: `projects.add` добавляет любой git-репозиторий
  (`src/main/ipc/projects.ts:242-249`). Решить до начала работы: либо `profile` без файла реестра
  отвечает exit code 3 («папка не в зарегистрированном Project-е»), либо владелец принимает ошибку
  в окне. Сказать владельцу до merge.
- **Отказ от угадывания раскладки меняет поведение Full Project-ов.** Сбой `profile` сегодня не
  мешает показать Ticket-ы из `<root>/.scratch` только у worfy, запущенного из Finder: там
  `epic-status` до `profile` не доходит. Таймаут `profile --json` сегодня даёт раскладку Full. После
  правки в обоих случаях окно покажет причину вместо Ticket-ов. Сказать владельцу до merge.
- **Пересечение с открытыми Ticket-ами.** `worfy-windows/05` правит `reader.ts`, `profile.ts` и
  `epic-status`; `worfy-windows/13` (First run на Windows) — список проверок. `worfy-windows/04`
  (hooks Harness на Node) в «Готово, когда» называет запуск через `open` «окружением, как из
  Finder» (строка 122 его файла). Прогон показал обратное: `open` из терминала отдаёт приложению
  окружение терминала. Его проверку нужно вести настоящим двойным кликом в Finder, как в этом
  Ticket-е. Ticket 41 этого же прогона (Epic, положенный после подключения Silent Project-а)
  правит `src/main/workflow/watch.ts` — тот же старт наблюдателя (`:216-234`, `:288`), что
  пункты 1 и 3 раздела «Что делаем». Перед началом работы сверить открытые PR и сказать исполнителям этих Ticket-ов (Epic
  `worfy-windows` ведёт отдельная Session Claude Code на Windows-ПК владельца).
- **Переменные только из `process.env`.** Скрипт, запущенный с окружением login shell, не видит
  переменных, заданных одному приложению (`CLAUDE_GATE_CONFIG`, `STUB_*` в test-ах). `HARNESS_HOME`
  добавляет `scriptEnv`. Проверить, что приёмка в песочнице находит свой Claude home: её login
  shell экспортирует те же переменные (`scripts/e3-sandbox.sh:173-180`).

## Итог

### Срез 2 (2026-10-14, ветка `worfy-harness/37-failure-visible`)

Срез 1 (пункт 1 «Что делаем»: окружение login shell для скриптов Harness) — PR #305, main `4d70e689`.
Срез 2 делает неудачу видимой: пункты 2–5 и низкие находки review среза 1.

**Что изменилось.**

- `harness/bin/epic-status`: без node в PATH и без `--root` — exit code 3, в stderr названы node и
  PATH. Раньше брался `<репозиторий>/.scratch`, и Silent Project получал пустой список. С `--root`
  node по-прежнему не нужен.
- `readResolvedProfile` различает два ответа. «Profile-а нет» (exit code 3, скрипта нет, Harness
  старше Silent mode, нет `_resolved.mode`) — Full, как раньше. «Вызов не удался» (exit code 127 и
  любой другой код кроме 0 и 3, exit code 4, timeout, ошибка запуска, ответ не того вида) —
  раскладка с `failed: true` и причиной (`failedLayout`).
- При `failed` `readWorkflow` и watcher отдают пустую модель с ошибкой `code: 'failed'` и текстом
  «worfy could not ask the Harness where the workflow of this Project lives: <причина>».
  `epic-status` не запускается. Текст причины строится из ответа `profile`, а не из
  `epic-status`.
- First run: строка «Harness scripts» в группе «Harness», после «Plugin dependencies»; проверок
  14 вместо 13. Она запускает `profile --help` тем же runner-ом и с тем же источником окружения,
  что и чтение Epic-ов. Состояния: Harness не установлен — warn; ответ 0 — OK; другой код — Failed
  с кодом и тем, что сказал stderr (строка Error упавшего node-скрипта, иначе первые строки); скрипта
  нет — warn. Остальные состояния добавили раунды ревью (ниже).
- `test/acceptance/e3.spec.ts` запускает приложение с PATH Finder-а и ждёт новую строку в OK.
- Пустой `SHELL` считается неустановленным. Источник окружения скриптов теперь действительно
  никогда не отклоняется.
- Комментарии, которые срез 1 сделал неверными: `src/main/harness/script-env.ts`,
  `src/main/agent/env.ts`, `scripts/e3-sandbox.sh`.

**Как раскладка читается снова после неудачи.** Без перезапуска приложения. Эта часть переделана
в раунде 1 ревью (ниже): в первом push-е повтор брал окружение login shell, снятое один раз за
запуск, и node, добавленный через rc-файл, не находился до перезапуска.

- Watcher (боковая панель и Canvas): пока раскладка `failed`, папки не отслеживаются. Раскладка
  спрашивается заново по расписанию (`LAYOUT_RETRY_MS`, один unref-таймер). Когда `profile`
  ответил, watcher начинает отслеживать папки и читает Epic-и. `close()` гасит таймер и ждёт
  текущее чтение.
- `readWorkflow` (Ship ticket, Run wave, Autopilot) спрашивает раскладку при каждом вызове.
  Canvas tools раскладку не читают вовсе: они запускают `epic-status` напрямую
  (`src/main/mcp/canvas-server.ts:423`), и без node получают его отказ с exit code 3.
- Общий кэш раскладок (документы и проверки) держит неудачу до 30 s, как любой ответ. Пока
  раскладка `failed`, документы и проверки видят поля Full — так было и до Ticket-а.

**Red first.** Каждый новый test был красным на исходниках main `4d70e689`:

- `harness/bin/tests/tickets-root.test.sh`, раздел 8: 3 FAIL (exit code 0, ответ из `.scratch`).
- `test/contract/workflow-profile.test.ts`: 17 красных. Модель на main показывала Epic `demo`,
  найденный угадыванием.
- `test/contract/first-run-checks.test.ts`: 5 красных («no check harness-scripts»).
- `test/contract/harness-script-wiring.test.ts`: 5 красных из 16. Остальные 11 закрепляют
  поведение среза 1; их охраняют мутанты M4–M16 и M19.
- e2e на сборке main: случай «нет node и в login shell» красный (текста причины нет); строка First
  run красная (13 строк вместо 14).

**Мутанты.** Каждый ставился в моём worktree, файл возвращался из копии. Все 21 красные.

| # | Порча | Чем пойман |
|---|---|---|
| M1 | `epic-status` без node снова берёт `<репозиторий>/.scratch` | shell test, 3 FAIL |
| M2 | неудачный вызов `profile` снова даёт Full | `workflow-profile`, 10 красных |
| M3 | строка First run берёт окружение экрана | `first-run-checks`, 2 красных |
| M4 | hub окна получает `process.env` | wiring |
| M5 | чтение Ship ticket получает `process.env` | wiring |
| M6 | Autopilot подмешивает `process.env` | wiring |
| M7 | canvas tools получают `process.env` | wiring |
| M8 | Project store получает `process.env` | wiring |
| M9 | кэш раскладок подмешивает `process.env` | wiring |
| M10 | сам `harnessScriptEnv` подмешивает `process.env` | wiring |
| M11 | wiring First run отдаёт окружение экрана | wiring |
| M12 | повторный запуск `epic-status` берёт `process.env` | wiring |
| M13 | `epic-status` подмешивает `process.env` | wiring, 3 красных |
| M14 | `readProjectLayout` подмешивает `process.env` | wiring, 2 красных |
| M15 | runner спрашивает окружение один раз | wiring |
| M16 | кэш раскладок спрашивает окружение один раз | wiring |
| M17 | `env` раскладки необязателен | typecheck, TS2322 |
| M18 | у Project store окружение по умолчанию | typecheck, TS2578 (`@ts-expect-error` в wiring test) |
| M19 | `HARNESS_HOME` пользователя побеждает найденный worfy | wiring |
| M20 | пустой `SHELL` проходит дальше | wiring, 2 красных |
| M21 | watcher не спрашивает раскладку снова | `workflow-profile`, test восстановления |

**Цифры.**

- `pnpm lint` — exit code 0; `pnpm typecheck` — exit code 0.
- `pnpm test` — exit code 0: 234 файла, 4940 passed, 66 skipped, 135 s.
- Shell tests: tickets-root 26 passed, harness-home 42 passed, preflight 14 passed — exit code 0.
  silent-mode — 86 passed, 1 failed («gate outside tree»: от окружения машины, тот же FAIL у
  reviewer-а на head и на base; срез его не трогает). В первом push-е числа silent-mode и
  harness-home были перепутаны.
- e2e на сборке ветки, под общим lock: `finder-path`, `first-run`, `silent-project`,
  `settings-health` целиком — 12 passed, exit code 0, 40 s. В «Health» сводка первого запуска
  теперь «1 failed · 3 warnings»: новая строка — warn, пока Harness не установлен.
- Снимок окна без node: в боковой панели «worfy could not ask the Harness where the workflow of
  this Project lives: the profile script failed with exit code 127: env: node: No such file or
  directory», панели «No epics yet» и рамок нет.

**Что не проверено.**

- Windows: ни скрипты, ни тесты не запускались. Новые тесты со stub-скриптами пропускаются на
  Windows (`skipIf`).
- `test/acceptance/e3.spec.ts` — только компилятор и eslint; приёмка не запускалась.
- Ручная проверка владельца двойным кликом в Finder и gate full — после merge и перед ним
  соответственно, не моя часть.

### Ревью PR #311, раунд 1 (2026-10-14)

Ревью (глубина `high`, head `57e9422a`) нашло две проблемы уровня medium и ряд low. Всё ниже — в
том же PR, один push.

**B1 / L1 / T1 — нет восстановления, когда причина в login shell.** Повтор раскладки и «Check
again» в First run брали окружение `agentEnv()`, снятое один раз за запуск. Пользователь, который
ставит node через nvm, fnm, volta, asdf или mise (они меняют PATH в rc-файле), видел ошибку до
перезапуска worfy. Что сделано:

- `recaptureAgentEnv()` (`src/main/agent/env.ts`) снимает окружение login shell заново. Все, кто
  зовёт его, пока снятие идёт, получают одно и то же: один запуск shell за раз. Новое окружение
  становится тем, что отвечает `agentEnv()`. Его получают скрипты Harness, а также Session-ы и
  Terminal Node-ы, запущенные после этого. Работающая Session остаётся с окружением, с которым
  она запущена. Снятие, которое упало в fallback, не заменяет удачное: shell, сломанный сейчас,
  не отнимает node у следующей Session.
- Источник окружения скриптов принимает запрос `fresh` (`src/main/harness/script-env.ts`).
  `always` — снять заново. `if-fallback` — снять заново, только если держится fallback (shell не
  удалось снять).
- Раскладка помечает, указывает ли неудача на окружение (`environmentFailure`): exit code 127 или
  126 (интерпретатор не найден или не запускается) и скрипт, который не удалось запустить.
  Watcher при повторе после такой неудачи просит `always`, после любой другой — `if-fallback`.
- Расписание повторов: 10 s, 30 s, 60 s, затем каждые 5 минут (`LAYOUT_RETRY_MS`,
  `src/main/workflow/watch.ts`). Раньше — каждые 10 s весь запуск. После ответа счётчик
  сбрасывается. Худший случай после того, как пользователь поставил node: до 5 минут. «Check
  again» в раунде 1 только снимал окружение заново, а боковая панель ждала свой таймер; с раунда 2
  он же сразу спрашивает раскладку у каждого watcher-а с неудачей (ниже, «Ревью PR #311, раунд 2»).
- «Check again» в First run (`firstRun.checks`, `src/main/ipc/first-run.ts`) сначала снимает
  окружение заново. Тот же канал зовёт экран при открытии без готового отчёта, так что открытие
  First run тоже снимает shell заново: один лишний запуск shell, около секунды.

**L3 / MUT-W8 — отслеживание после восстановления не было под test-ом.** Новый test в
`test/contract/harness-script-env.test.ts` проверяет оба пункта сразу. Он берёт источник
окружения приложения и настоящие скрипты: `SHELL=/bin/sh`, `HOME` в песочнице, `.profile` без
node. Окно показывает причину с exit code 127. Затем `.profile` переписывается с node, и Epic
появляется без перезапуска. Затем в Workflow folder пишется новый Ticket, и он тоже появляется.

**Низкие находки.**

- L2: `close()`, пришедший, пока watch восстановленной раскладки ждёт `ready` chokidar, больше
  не зависает. Ожидание `ready` гонится с обещанием закрытия. После чтения раскладки и после
  `watch()` проверяется `closed`: после закрытия нет ни watch, ни запуска `epic-status`. Test
  гонки скопирован у reviewer-а (`test/contract/workflow-watch-retry.test.ts`).
- Ветки без test-ов. Watcher:
  - ничего не отслеживается, пока раскладка failed (MUT-W1) — chokidar посчитан через `vi.mock`;
  - расписание по умолчанию (MUT-W14) — fake timers;
  - `close()` не оставляет таймера (T4) — `vi.getTimerCount()`.

  Строка First run — нет скрипта, timeout, ошибка запуска (MUT-F5/F6/F7, T2).
- T3: e2e First run проверяет, что в `/usr/bin` и `/bin` нет node. Деталь строки должна содержать
  `exit code 127: env: node: No such file or directory`, а не только неизменную подсказку.
- B2: строка First run на Windows — warn «worfy cannot run the Harness scripts on Windows yet
  (worfy-windows ticket 05)». Скрипт ищется по пути до запуска. Нет файла — warn «no profile
  script in …». Файл есть, но не запускается — fail «profile could not be started: …». cwd —
  папка bin самого Harness, а не `tmpdir()`.
- B5: подсказка своя для каждой причины: нет node, timeout, падение скрипта, скрипт не
  запускается. Из stderr упавшего node-скрипта берётся строка Error (`TypeError: …`), а не
  `Node.js vNN` и не stack. Иначе — первые строки, не больше 400 символов. Причина в боковой
  панели обрезается до трёх строк.
- L4:
  - `harness/bin/profile` сохраняет последнюю строку resolver-а, например «registry <путь>
    cannot be read: …». Test — `harness/bin/tests/profile.test.sh`.
  - Текст timeout называет предел: «did not answer within 15 s».
- L6: ответ с exit code 0 не того вида (`null`, список, строка, `_resolved: null`) — неудачный
  вызов, а не «Profile-а нет».
- B6: три комментария исправлены: `script-env.ts` (про `epic-status` и про HARNESS_HOME старого
  Harness) и шапка `profile.ts`.
- L7 / B3 / T5: canvas tools убраны из списка читателей раскладки. Числа shell tests исправлены
  (выше, «Цифры» среза 2).

**Изменения поведения, добавленные в список PR (B4, L5).**

- Mac, где login shell не снимается (tcsh или csh, или rc-файлы дольше 10 s): каждый Project
  теперь показывает причину. Раньше Epic-и показывались по догадке `.scratch`.
- Autopilot без присмотра останавливается в конце хода на одном неудачном `profile --json`:
  timeout под нагрузкой или exit code 1, пока registry переписывается. Раньше `epic-status` обычно
  всё равно читал Ticket-ы. Повтор в этом чтении — отдельный Ticket оркестратора.

**Red first** — на исходниках head `57e9422a` (`impl37/r1-red.sh`, исходники возвращены из копии):

- `harness-script-env`: test восстановления — «not within 20000 ms: the Epic after node was
  added».
- `harness-script-wiring`: 4 красных. Повтор после 127 не просит `always`. «Check again» не
  снимает shell. `harnessScriptEnv` не знает `fresh`.
- `agent-env-recapture`: 3 из 3.
- `workflow-watch-retry`: 10 из 13:
  - расписание;
  - закрытие во время запроса раскладки;
  - 8 из 10 случаев гонки `close()` — случаи «0 microtasks» зелёные и на head, как у reviewer-а.

  Test «ничего не отслеживается, пока раскладка failed» зелёный и на head: head здесь прав, test
  охраняет это поведение, мутант W1.
- `workflow-profile`: 18 красных — таблица неудачных вызовов с признаком окружения, timeout с
  пределом, формы ответа, обрезка причины.
- `first-run-checks`: 7 красных — новые ветки строки.

**Мутанты раунда 1.** Каждый ставился в моём worktree (`impl37/mut3.py`), файл возвращался из
копии. Все 26 мутантов (28 запусков: R1 и W8 — против двух файлов) красные. Два сначала выжили (L2b, B5b); под них добавлены test-ы, после этого оба
красные.

| # | Порча | Чем пойман |
|---|---|---|
| R1 | источник окружения не снимает shell заново при `always` | test восстановления; wiring |
| R2 | watcher при повторе ничего не просит | wiring, test watcher-а |
| R3 | раскладка не несёт признак окружения | `workflow-profile`, 3 красных |
| R4 | exit code 127 не считается причиной в окружении | test восстановления |
| R5 | снятия не общие | `agent-env-recapture` |
| R6 | fallback заменяет удачное снятие | `agent-env-recapture` |
| R7 | новое снятие не становится тем, что держит `agentEnv()` | `agent-env-recapture`, 2 красных |
| R8 | «Check again» не снимает shell заново | wiring |
| W8 | нет `watch()` после восстановления | test восстановления (Ticket 02); `workflow-watch-retry` |
| W1 | `start` отслеживает и failed-раскладку | `workflow-watch-retry` |
| W14 | без отступа: всегда 10 s | `workflow-watch-retry` |
| W14b | по умолчанию 10 минут | `workflow-watch-retry` |
| T4 | `close()` без `clearTimeout` | `workflow-watch-retry` (таймер остаётся) |
| L2 | ожидание `ready` без гонки с закрытием | `workflow-watch-retry`, 8 красных |
| L2b | нет проверки `closed` после запроса раскладки | `workflow-watch-retry`, закрытие во время запроса |
| F5 | timeout без своей ветки | `first-run-checks` |
| F6 | нет скрипта — fail | `first-run-checks` |
| F7 | ошибка запуска — OK | `first-run-checks`, 2 красных |
| B2 | нет ветки Windows | `first-run-checks` |
| B5a | одна подсказка на все причины | `first-run-checks` |
| B5b | последняя строка stderr вместо строки Error | `workflow-profile` |
| B5c | причина без обрезки | `workflow-profile` |
| B5d | весь stderr в причине | `workflow-profile` |
| L4a | timeout без предела | `workflow-profile`, 3 красных |
| L4b | `profile` теряет строку resolver-а | `profile.test.sh` |
| L6 | ответ не того вида — «Profile-а нет» | `workflow-profile`, 3 красных |

**Цифры раунда 1.**

- `pnpm lint` — exit code 0; `pnpm typecheck` — exit code 0.
- `pnpm test` — exit code 0: 236 файлов, 4975 passed, 66 skipped, 127 s. Первый прогон того же
  кода: один красный — test watcher-а в `harness-script-wiring` не дождался ответа за 4 s под
  нагрузкой всего suite; ожидание поднято до 15 s, второй прогон зелёный.
- Shell tests: profile 152 passed (exit code 0), tickets-root 26, harness-home 42, preflight 14
  (exit code 0); silent-mode 86 passed, 1 failed — «gate outside tree», от окружения.
- e2e на сборке ветки, под общим lock: `first-run` и `finder-path` целиком — 7 passed, exit code 0.

**Что не проверено в раунде 1.**

- Windows: ветка строки First run проверена с `platform: 'win32'` на macOS; на Windows не
  запускалась.
- `dash` как `/bin/sh` (Linux CI) для test-а восстановления: локально `/bin/sh` — bash macOS.
  CI ответил: зелёный (run 38530317651).
- Худший срок восстановления по умолчанию (до 5 минут) не измерялся в приложении: расписание
  проверено fake timers, восстановление — с `layoutRetryMs: 100`.

### Ревью PR #311, раунд 2 (2026-10-14)

Ревью (глубина `medium`, head `6699e7e9`) нашло одну проблему уровня medium и ряд low. Всё ниже —
в том же PR, один push; раунд 3 — последний.

**R2-REST-1 / RC1 — «Check again» не доходил до боковой панели.** Обработчик снимал login shell
заново и строил отчёт, а watcher с неудачной раскладкой ждал свой таймер — до 5 минут. Что
сделано:

- `WorkflowWatcher.retryFailedLayout()` (`src/main/workflow/watch.ts`): раскладка с неудачей
  спрашивается сразу. Таймер повтора снимается, отступ начинается заново (следующая неудача ждёт
  10 s). Запрос окружения — простой, без `fresh`: shell только что снят, свой запуск shell это
  чтение не делает. Здоровый watcher и закрытый watcher не трогаются (метод возвращает false).
- `WorkflowHub.retryFailedLayouts()`: то же для каждого Project-а hub-а; Project, чей первый
  read упал, пропускается; метод не отклоняется.
- `recaptureForCheckAgain(hub)` (`src/main/harness/script-env.ts`): снять shell, затем спросить
  hub. Обработчик `firstRun.checks` (`src/main/ipc/first-run.ts`) зовёт его с `workflowHub`,
  импортированным напрямую, — не зависит от порядка регистрации IPC-обработчиков. Отчёт не ждёт
  чтения Epic-ов.
- Гонки: «Check again», пришедший, пока идёт чтение раскладки. Чтение в очереди спрашивает
  раскладку, только если она ещё failed: второй `watch()` не начинается. После восстановления
  таймер, поставленный упавшим чтением, снимается, и checkout читается заново, даже если упавшее
  чтение сняло пометку.
- То же даёт выход RC5 (node падает на снятом PATH, exit code 1): «Check again» после исправления
  читает раскладку сразу.

**Низкие находки.**

- R2-REST-2: `scriptFailureDetail` под test-ами — 3 строки через « — », 400 символов, фильтры
  `at …`, `Node.js vNN` и строки из `^`, stderr без строки Error. Строка из нескольких `^` теперь
  тоже отбрасывается.
- R2-REST-3: `harness/bin/profile` берёт из stderr resolver-а строку Error, иначе последнюю
  строку, которая не `Node.js v…` и не `at …` — то же правило, что у `scriptFailureDetail`.
- R2-REST-4: runner отличает свой kill по пределу времени (`error.killed`) от сигнала. Сигнал —
  «was ended by the signal SIGSEGV» и подсказка о падении, в раскладке, в строке First run и в
  причине `ticket root` («failed with the signal …», вместо «exit code timeout» — «a timeout»).
- RC2 / R2-REST-5: ошибка запуска, кроме ENOENT (EACCES, вывод больше предела), не считается
  неудачей окружения: новый shell не чинит права файла. Окружение — только exit code 127 и 126.
- RC6: test-ы гонки `close()` проверяют, что после закрытия ничего не отслеживается и
  `epic-status` не запускается, и для `links-read-first` (Windows).
- R2-REST-6: test-ы на предел строки 15 s, подсказку 126 в строке, `_resolved: []`.
- RC3, RC4, R2-REST-7, R2-REST-8: тексты — doc comment `recaptureAgentEnv`, комментарий
  обработчика, имя test-а, замечание про libuv смягчено, этот файл, текст PR.

**Red first** — на исходниках head `6699e7e9` (исходники возвращены из копии):

- 17 красных в 6 файлах vitest: `workflow-watch-retry` 6 (новые «Check again»), `workflow-profile`
  7 (сигнал в runner-е, в раскладке, в `ticket root`; ошибки запуска; строка из `^`; timeout
  `ticket root`), `first-run-checks` 1 (сигнал), `agent-env-recapture` 1, `harness-script-env` 1
  (`TypeError: recaptureForCheckAgain is not a function`), `harness-script-wiring` 1 (порядок
  «recapture → failed layouts asked → checks»).
- `profile.test.sh`: 3 FAIL из 155.
- Test-ы `scriptFailureDetail` про 3 строки и 400 символов, предел 15 s, подсказка 126,
  `_resolved: []` и гонки `close()` зелёные и на head: они закрепляют поведение head, их охраняют
  мутанты ниже.

**Мутанты раунда 2.** Каждый ставился в этом worktree, файл возвращался из копии. Все 37 красные;
H2 сначала выжил, под него усилен test.

| # | Порча | Первый красный test |
|---|---|---|
| C1 | `retryFailedLayout` ничего не делает | `harness-script-env`, «"Check again" with node added…» |
| C2 | он просит `always` | `harness-script-env`, тот же (2 запуска shell) |
| C3 | таймер не снимается | `workflow-watch-retry`, «retryFailedLayout: asked now…» |
| C4 | отступ не сбрасывается | `workflow-watch-retry`, тот же |
| C5 | здоровый тоже спрашивается | `workflow-watch-retry`, «does nothing for a healthy layout…» |
| C6 | закрытый тоже спрашивается | `workflow-watch-retry`, тот же |
| C7 | чтение в очереди спрашивает здоровую раскладку | `workflow-watch-retry`, гонка «recovers» |
| C8 | таймер после восстановления остаётся | `workflow-watch-retry`, гонка «fails again» |
| C9 | checkout после восстановления не читается | `workflow-watch-retry`, гонка «recovers» |
| C10 | hub не ловит упавший старт | `workflow-watch-retry`, «still starting…» |
| C11 | `recaptureForCheckAgain` не зовёт hub | `agent-env-recapture` |
| C12 | hub раньше снятия shell | `agent-env-recapture` |
| C13 | обработчик не зовёт `workflowHub` | `harness-script-wiring` |
| C14 | запрос «Check again» теряется | `harness-script-env` |
| S1 | сигнал снова как timeout в runner-е | `first-run-checks`, «ended by a signal» |
| S2 | без проверки `killed` | `first-run-checks`, «a timeout» |
| S3 | раскладка: сигнал как timeout | `workflow-profile`, «a failed call — a signal» |
| S4 | строка: сигнал как timeout | `first-run-checks`, «ended by a signal» |
| S5 | строка: сигнал с подсказкой timeout | `first-run-checks`, тот же |
| S6 | `ticket root`: сигнал как timeout | `workflow-profile`, «`ticket root` failing (a signal)» |
| E1 | ошибка запуска снова «окружение» | `workflow-profile`, «a script that cannot be started» |
| D1–D6 | 4 строки; 401 символ; без фильтра `at`; без фильтра `Node.js`; другой разделитель; без фильтра `^` | `workflow-profile`, describe `scriptFailureDetail` |
| P9 | `_resolved: []` как Harness до Silent mode | `workflow-profile`, «_resolved: []» |
| X3 | предел строки по умолчанию 10 s | `first-run-checks`, «the time limit is 15 s…» |
| X6 | подсказка node только для 127 | `first-run-checks`, «exit code 126» |
| N11 | нет проверки `closed` после `watch()` | `workflow-watch-retry`, гонка `close()` (chokidar, 4 microtasks) |
| N25 | нет второго `unwatch` в `close()` | `workflow-watch-retry`, гонка `close()` (links-read-first, 4 microtasks) |
| H1 | `profile`: последняя строка без выбора Error | `profile.test.sh`, «error properties» |
| H2 | `profile`: первая строка вместо последней | `profile.test.sh`, «message, stack and version lines» |
| H3 | `profile`: без фильтра `Node.js` | `profile.test.sh`, тот же |
| H4 | `profile`: без фильтра `at` | `profile.test.sh`, тот же |
| H5 | `profile`: прежняя последняя сырая строка | `profile.test.sh`, «resolver crash» |

**Цифры раунда 2.**

- `pnpm lint` — exit code 0; `pnpm typecheck` — exit code 0.
- `pnpm test` — exit code 0: 236 файлов, 5003 passed, 66 skipped, 121 s.
- `profile.test.sh` в песочнице — 155 passed, exit code 0.
- e2e не запускались: `test/e2e/` в этом push-е не менялись.

**Что не проверено в раунде 2.**

- «Check again» в собранном приложении (e2e) — только contract test-ы с настоящими скриптами.
- Windows: `links-read-first` проверен на macOS; на Windows не запускался.
- Сигнал от настоящего node (SIGSEGV, SIGKILL при нехватке памяти) — проверен скриптом, который
  шлёт сигнал сам себе.
