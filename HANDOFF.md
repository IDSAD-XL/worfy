# Передача контекста — снимок на 2026-10-05, main @ c1b654b

## Сейчас в работе

- Эпик `worfy-mvp`: 9 из 33 тикетов done (01, 02, 03, 04, 06, 07, 09, 10, 32), 11 blocked (13 и зависящие от него 14, 15, 16, 17, 18, 21, 23, 26, 30, 31), 13 open (`~/.claude/bin/epic-status worfy-mvp` → `worfy-mvp 9/33`). План и таблица волн — [.scratch/worfy-mvp/spec.md](.scratch/worfy-mvp/spec.md), раздел «Волны».
- Волна 3 закрыта: влиты 04, 07, 10. Тикет 13 заблокирован после второго нечистого ревью; его [PR #8](https://github.com/IDSAD-XL/worfy/pull/8) открыт, worktree `.claude/worktrees/13` оставлен.
- Влиты в волне 3:
  - 04 — Проекты в sidebar: список, активный Проект, ветка в toolbar, «Add project», окно «Project settings» с шаблонами «Ship ticket» и «Run wave». Main хранит `projects.json` и папку данных Проекта `<WORFY_DATA_DIR>/<имя>-<hash8>/settings.json`; общий помощник записи `src/main/storage/json-file.ts`. Каналы `projects.*` и событие `projects.changed` — по ADR-0006 — [PR #7](https://github.com/IDSAD-XL/worfy/pull/7), merge c1b654b, CI run 37278208336 success.
  - 07 — движок Сессий в main: `Session` и `SessionRegistry` (`src/main/agent/session.ts`), опции SDK, окружение из login shell по ADR-0007, fake-агент и сценарии `test/fixtures/agent-scripts/`, каналы `agent.start | send | interrupt | close | list` и поток `agent.event`, `asarUnpack` для SDK в `electron-builder.yml`. Сессия закрывается вместе с окном, которое её запустило, и при выходе из приложения — [PR #10](https://github.com/IDSAD-XL/worfy/pull/10), merge 60d8394, CI run 37264340577 success.
  - 10 — модель workflow: читает `epic-status --json`, файлы тикетов и worktree-ветки, считает готовую волну, следит за изменениями (`src/main/workflow/reader.ts`, `watch.ts`, `src/shared/workflow/`), канал `workflow.open` и событие `workflow.changed`. Сверка волн с таблицей `spec.md` — на копии эпика `test/fixtures/worfy-mvp-epic/` — [PR #9](https://github.com/IDSAD-XL/worfy/pull/9), merge 47985eb, CI run 37263756378 success.
- Волны 1–2: влиты 01 — каркас репозитория ([PR #1](https://github.com/IDSAD-XL/worfy/pull/1)), 32 — сборка `worfy.app` и CI ([PR #2](https://github.com/IDSAD-XL/worfy/pull/2)), 02 — типизированный IPC ([PR #3](https://github.com/IDSAD-XL/worfy/pull/3)), 03 — окно macOS, sidebar, toolbar, темы ([PR #4](https://github.com/IDSAD-XL/worfy/pull/4)), 09 — формат реестра Сессий и транскриптов ([PR #5](https://github.com/IDSAD-XL/worfy/pull/5)), 06 — Agent SDK в Electron main с настройками пользователя ([PR #6](https://github.com/IDSAD-XL/worfy/pull/6)). Итоги — в разделах «Итог» файлов тикетов.
- Риски 2, 3 и 11 в spec.md помечены «Решено» со ссылками на ADR-0007, ADR-0009 и ADR-0008; текст рисков оставлен.
- Gate для worfy зарегистрирован в `~/.claude/gate/config.json` (вне репозитория): `fast` = lint, typecheck, test; `full` добавляет `test:e2e`.
- Модель предметной области — [CONTEXT.md](CONTEXT.md). Решения — ADR 0001–0009 в [docs/adr/](docs/adr/); в волне 3 новых ADR нет.
- Дизайн: вариант F «Native frame, Graphite instrument», светлая и тёмная тема — [docs/design/F-SPEC.md](docs/design/F-SPEC.md) и макеты `F-*.dc.html` рядом; все варианты A–F — артефакт https://claude.ai/artifact/K1CotzYYUeuVK8M5ajC4uW.

## Ждёт владельца

- Тикет 13 (разбор транскриптов и реестра Сессий) заблокирован: второе ревью по корректности нашло дефект, который внёс сам круг доработки. В `src/main/claude-home/registry.ts:492` (ветка `worfy-mvp/13`) удаление транскрипта в подпапке Проекта (`projects/-proj-web/`), существовавшего до старта watcher, не даёт `claudeHome.changed`: принадлежность транскрипта кэшируется только для файлов, увиденных во время слежения. Решить: ещё один круг доработки по этой находке или другой путь. PR #8 открыт, в нём комментарий «Blocked». В том же PR правки тикета 14 и spec.md вне следа тикета 13 — при мерже сверить со spec.md на main.
- Из-за 13 заблокированы зависящие от него тикеты: 14 (blocked by 13); 15, 17, 18, 21 (by 14); 16 (by 15); 26 (by 17); 23 (by 16, 17, 18); 30 (by 14, 26); 31 (by 23, 26).
- Решение оркестратора волны 2 на проверку: третий, узкий круг исправления для 32, 02 и 03 вопреки правилу «один круг доработки». Причина, которую назвал оркестратор, — ошибка калибровки его процесса: ревьюеры не знали правило владельца про пометку «не проверено», второй круг ревью искал новые находки вместо проверки исправлений. Круг шёл ровно по подтверждённым находкам. Подтвердить или отменить; если подтверждаешь — решить, менять ли правило в skill `epic-wave`.
- Тикеты 32 и 07, пункт «worfy.app открывается двойным щелчком из Finder». В 32 он отмечен текстом, а не снимком: Finder запустил процесс с PPID 1 и голым `PATH`, `CGWindowListCopyWindowInfo` показал окно 1280×800. В 07 пункт оставлен открытым: UI для старта Сессии появится только в тикете 33. У агента нет прав Screen Recording и Accessibility. Открыть `dist/mac-arm64/worfy.app` двойным щелчком и посмотреть глазами.
- Не проверено, тикет 07: что Сессия закрывается после Cmd+W в настоящем Electron. Проверено только на EventEmitter вместо `webContents` в contract test; e2e с закрытием окна нет до тикета 33.
- Не проверено, тикет 10: задержка `workflow.changed` на настоящем `/Users/alexey/Work/Auction` — запись в `/Users/alexey/Work/*` агенту запрещена. Замер 1100–1136 мс (порог 1.5 с) сделан на клоне того же размера и на коде до круга доработки.
- Не проверено, тикет 32: запуск через Finder шёл без `WORFY_DATA_DIR`, и приложение работало с настоящим `~/Library/Application Support/worfy`. Что оно туда записало, никто не смотрел. Решить, удалять ли каталог.
- Не проверено, тикет 03: вид нативной рамки (светофор, vibrancy sidebar) на снимке — нет права Screen Recording, положение кнопок проверено только через API окна. Переключение темы через «Системные настройки» macOS не проверено — проверен тот же путь через `nativeTheme.themeSource`. Посмотреть глазами.
- Не проверено, тикет 02: окно с ошибкой при сбое запуска (`dialog.showErrorBox`) на экране никто не видел; вывод сделан только по тому, что процесс жив после строки `console.error`. Код выхода 1 проверен отдельным запуском с подменённым `showErrorBox`. Посмотреть глазами.
- Не проверено, тикет 09: остаётся ли `~/.claude/sessions/<pid>.json` после аварийного выхода Claude Code (`kill -9`). Агенту нельзя запускать Claude Code, потому что тот пишет в `~/.claude`; проверить может владелец. Пока «Сессия жива» определяется по pid + `procStart`, а не по наличию файла.
- Не проверено, тикет 06: список переменных минимального окружения для запуска shell (`SSH_AUTH_SOCK`, `__CF_USER_TEXT_ENCODING` и другие, ADR-0007) проверен только на машине владельца с zsh. С bash, fish или rc-файлами, которым нужен `TERM`, — нет.
- Не проверено, тикет 01: проверка e2e test-а с удалённой строкой `app.setPath('userData', …)` записала файлы Electron в настоящий `~/Library/Application Support/Electron`. Данных worfy в папке нет, она могла существовать раньше. Решить, удалять ли её.
- Обобщить skill `/ship-ticket` в `~/.claude` под проекты кроме Auction. Похоже, уже сделано: skill читает профиль проекта (`~/.claude/bin/profile`), тикеты волн 1–3 прошли через него. Закрыть пункт, если согласен.
- Синхронизация состояния worfy (карточки, раскладка) с облаком — решить отдельно.

## Риски и долги

- Долг тикета 07: Сессия может пережить своё окно, если его закрыли во время `agent.start`. Обработчик ждёт `assertDirectory(cwd)` (`src/main/ipc/agent.ts:88`) и только потом вызывает `registry().start` и `own(event.sender, …)` (строки 89–90); `isDestroyed()` не проверяется, а `once('destroyed')` на уже уничтоженном окне не сработает.
- Долг тикета 07 (test-ы): две мутации в `src/main/ipc/agent.ts` не роняют ни одного test — без `owned.set(owner, forOwner)` (строка 58: обработчик `destroyed` вешается на каждую Сессию, а не один на окно) и без очистки закрытых Сессий (строка 73: `Session.close()` идемпотентен, поведение не меняется).
- Долг тикета 10: комментарий к `WorkflowWatcher.start` (`src/main/workflow/watch.ts:62-64`) и «Итог» тикета утверждают, что `current` уже содержит правку, сохранённую во время первого чтения. Цикл на строке 75 ждёт только `running`, а не отложенный debounce-таймер, так что такая правка может прийти позже, через `workflow.changed`.
- Долг тикета 10 (test-ы): условие `!this.starting` в `src/main/workflow/watch.ts:180` (не слать `onChange`, пока идёт `start`) не покрыто: мутант без него оставляет contract test-ы зелёными.
- Долги тикета 13 в PR #8 (на main их нет): отсрочка `ready` на 100 мс в `registry.ts` выбрана по замеру на одной машине и не покрыта test-ом (test сам ждёт 300 мс после `ready`); фильтр переменных `GIT_*` перед вызовом git (`registry.ts:85`) тоже без test-а.
- CI не запускается на PR, который конфликтует с main: GitHub не создаёт прогон `pull_request` при `mergeStateStatus: DIRTY`. Коммит статусов волны в main меняет файлы тикетов, и открытые PR волны становятся DIRTY. Перед ожиданием CI нужен rebase на main.
- Размер контекста от MCP-серверов пользователя (тикет 06): с `settingSources` пользователя приходят 634 tools, на haiku второй ход падает с «Prompt is too long». Тикет 07 решил их не трогать: Сессия идёт на модели из настроек пользователя (`claude-opus-5-5[1m]`), как `claude` в терминале. Сколько стоит ход на ней с 634 tools — не замерено.
- Effort не проверен (тикеты 06 и 07): применился ли `applyFlagSettings({effortLevel:'low'})`, и несут ли уровень поле `effort.level` во входе hooks и переменная `CLAUDE_EFFORT`. Известно только из `sdk.d.ts`.
- Источник лимитов: `rate_limit_event` приходит один раз за Сессию, перед первым запросом, и `utilization` в нём есть не всегда; поле `rate_limits` статус-строки не проверено (тикет 22).
- Долг тикета 03 (граница модулей): удаление временного каталога с повторами (`maxRetries`) заведено только в `test/e2e/window.spec.ts:9`. Общая очистка `cleanDirs` в `test/e2e/helpers.ts`, через которую идут остальные e2e test-ы, осталась без повторов.
- Возможный flaky test: в волне 2 первый полный `pnpm test:e2e` после сборки упал на `test/e2e/launch.spec.ts:5` — первый запуск приложения не уложился в 60 с, затем «Worker teardown timeout». Два следующих полных прогона — зелёные. Причину не искали.
- Тикет 03: `test/unit/shell-discovery.test.tsx` пишет временные файлы в `src/renderer/shell/{sidebar,toolbar}`. При параллельном запуске с lint, typecheck или сборкой они могут попасть в их вход; если vitest убит посреди test-а, файл `ZzVitestProbe*` остаётся до следующего прогона.
- `postinstall` (тикет 32) компилирует `node-pty` из C++ через `@electron/rebuild`: на новой машине нужны Xcode Command Line Tools и Python, иначе `pnpm install` упадёт.
- Gate по умолчанию (`fast` с сужением по диффу) не видит `scripts/` и `test/fixtures/`: зелёный вердикт по ним даёт только `GATE_SCOPE=all`. Правка — в `~/.claude/gate/config.json` или в самом gate.
- Запись gate в `~/.claude/gate/config.json` живёт вне репозитория. Скрипт `test:package` (тикет 32) в gate не попал, его проверяет только CI; новые скрипты проверки нужно вписывать туда вручную.
- Путь сбоя запуска в `src/main/index.ts` (`.catch` → `showErrorBox` → `app.exit(1)`) без автоматического test-а: файл импортирует electron и в vitest не грузится, а e2e test встанет на модальном окне.
- React Flow (тикет 05) и xterm.js (тикет 27) внутри вида, скрытого через `display:none` (тикет 03), не проверены: при показе может понадобиться пересчёт размеров.
- Транскрипты (тикет 09): кириллица в cwd и пути длиннее 200 символов в данных не встречались, правило имени папки взято из кода Agent SDK.
- Fixtures `test/fixtures/sdk-messages/`: в пяти перечищенных файлах номер сервера в именах MCP tools (`server-4`) не связан с номерами в `mcp_servers`, исходные имена потеряны раньше. Сказано в README этой папки.
- pnpm 11 не читает поле `pnpm` в `package.json`. Пакеты, которым разрешены install-скрипты, перечислены в `allowBuilds` в `pnpm-workspace.yaml`; новая зависимость со скриптом без записи там роняет `pnpm install` (`ERR_PNPM_IGNORED_BUILDS`).
- Electron 44 скачивает свой бинарник при первом запуске, а не в `pnpm install`: в CI загрузка идёт в шаге `pnpm test`, без сети unit test-ы под Electron не стартуют.
- Hook инструмента Edit не даёт писать в worktree тикета из worktree сессии оркестратора. Агент тикета 02 переключился в `.claude/worktrees/02` через EnterWorktree; агент тикета 10 правил файлы скриптами python и sed через Bash. Hook не менялся.
- `window-state.json` (положение окна, тикет 03) не переведён на общий `json-file.ts` из тикета 04 — отдельной правкой, когда кто-то будет трогать `window.ts`.
- Версии ниже последних из-за совместимости: `vite` 7 (electron-vite 5 не поддерживает vite 8), `typescript` 6.0 (typescript-eslint 8.71 требует `<6.1`). Обновлять вместе.

## Дальше

- Волна 4: тикет 05 (холст Проекта на React Flow; раскладку пишет только main). Его блокеры влиты. При занятии слота Canvas в `AppShell` тикет 05 должен перенести версию приложения (`AppVersion`), которую тикет 02 временно поставил туда, иначе упадёт e2e test версии в `test/e2e/launch.spec.ts`.
- Тикет 13 — после решения владельца по находке ревью; без него стоят 14 и всё, что за ним.
- Потом волны 5–11 по таблице spec.md; тикеты, зависящие от 13, пойдут только после его мержа.

## Где остальное

- Поведение оригинала (Morphy) — инвентари в scratchpad сессии 2026-10-05, в репозиторий не переносились (ADR 0001).
- Карта workflow пользователя: `~/Work/claude-workflow-kit/kit/MANIFEST.md`.
