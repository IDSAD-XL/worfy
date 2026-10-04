# worfy MVP: холст, на котором виден и запускается workflow работы с агентами Claude

Status: draft
Source: [CONTEXT.md](../../CONTEXT.md), [ADR-0001](../../docs/adr/0001-clean-room-reimplementation.md), [ADR-0002](../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md), [ADR-0003](../../docs/adr/0003-cards-as-files-canvas-via-tools.md), [ADR-0004](../../docs/adr/0004-stack-electron-ts-react-flow-agent-sdk.md), [ADR-0005](../../docs/adr/0005-worfy-own-state-inventory.md), дизайн [F-SPEC.md](../../docs/design/F-SPEC.md) + [BRIEF.md](../../docs/design/BRIEF.md) + макеты `docs/design/F-*.dc.html`
Тикеты: эпик `worfy-mvp`, нумерация с `01`, простой диалект шапки (`Type:` / `Status:` / `Blocked by:` / `Source:`), чтобы их читали `epic-status` и `ticket` без доработок.

## Цель

worfy — личное macOS-приложение на Electron для одного локального пользователя: без входа,
без телеметрии, без управления с телефона. На Холсте Проекта (один git-репозиторий — один
Холст) видно, как идёт работа с агентами Claude: Эпики и их Тикеты с блокировками и готовой
Волной, Сессии и их Subagent-ы, Привязка агентов к Тикетам, Gate, PR и CI. С того же Холста
работа запускается: «Ship ticket», «Run wave», ответ на запрос разрешения. Агенты по ходу
работы собирают Карточки — маленькие HTML-приложения на Холсте.

worfy ничего не решает за workflow. Правда о работе остаётся в файлах Тикетов, `HANDOFF.md`,
ADR, скриптах `ticket` и `epic-status`, транскриптах Claude Code и состоянии Gate
([ADR-0002](../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md)). worfy читает их и меняет
состояние только теми же инструментами: `ticket` и skills, которые Проект сам назначил действиям
«Ship ticket» и «Run wave» в своих шаблонах. Статус Тикета worfy сам не пишет никогда.

Агенты запускаются через Claude Agent SDK с `settingSources: ['user', 'project', 'local']`.
Значит, глобальный `~/.claude/CLAUDE.md`, hooks, skills, subagent-ы и MCP-сервера пользователя
действуют так же, как в терминале. Модель — только Claude, через локально залогиненный Claude
Code (подписка). Ключей API в приложении нет, приватных OAuth endpoint-ов worfy не вызывает.

Код пишется с нуля. Декомпилированный Morphy — только описание поведения
([ADR-0001](../../docs/adr/0001-clean-room-reimplementation.md)).

## Как устроено

**Процессы.** Main process владеет всем состоянием, файлами, дочерними процессами и SDK-сессиями.
Renderer (React + React Flow) только показывает и шлёт команды. Preload — единственный мост,
через `contextBridge`, с `contextIsolation` и `sandbox`.

**Раскладку пишет только main** ([ADR-0003](../../docs/adr/0003-cards-as-files-canvas-via-tools.md)).
Renderer и MCP-tools холста шлют операции (создать, сдвинуть, изменить размер, скрыть Узел), main
проверяет их, сохраняет атомарно (tmp + rename) и рассылает новое состояние.

**Собственное состояние worfy** ([ADR-0005](../../docs/adr/0005-worfy-own-state-inventory.md))
лежит в `~/Library/Application Support/worfy/`: список Проектов и последние известные Лимиты — в
корне, а в `<ключ проекта>/` — настройки Проекта (шаблоны действий), Раскладка, Карточки, данные
Карточек, ручные Привязки, вложения к сообщениям, корзина. В репозитории Проектов worfy не пишет
ничего: ни файлов, ни коммитов. Ключ проекта —
имя папки плюс первые 8 символов sha256 от абсолютного пути. В tests корень переопределяется
переменной `WORFY_DATA_DIR`, а `~/.claude` — переменной `WORFY_CLAUDE_HOME`.

**Шаблоны действий.** У каждого Проекта свой процесс, поэтому «Ship ticket» и «Run wave» шлют
текст из шаблона Проекта, а не зашитую команду. Подстановки — `{epic}`, `{NN}`, `{wave}`,
`{slug}`, `{branch}`. По умолчанию: Ship ticket → `/ship-ticket {epic} {NN}`, Run wave →
`/epic-wave волна {wave} эпика {epic}`. Шаблоны правятся в «Project settings». Действие без
шаблона показано неактивным с подсказкой. Что делает skill, worfy не знает. Хранение — тикет 04,
подстановка и действия — тикет 23.

**Режим разрешений.** Каждая новая Сессия стартует в `bypassPermissions`. Если пользователь
переключил режим, на запрос разрешения «Always allow» разрешает этот инструмент до конца этой
Сессии: в памяти main, без записи в файлы настроек и без переноса в другие Сессии (тикет 21).

**Раскладка папок** (одна на весь эпик, тикеты ссылаются на неё):

| Путь | Что там |
| --- | --- |
| `src/main/` | main process: `index.ts` (запуск), `window.ts`, `ipc/<домен>.ts`, папки доменов `projects/`, `layout/`, `agent/`, `workflow/`, `docs/`, `claude-home/`, `gate/`, `github/`, `actions/`, `mcp/`, `cards/`, `terminal/`, `storage/` |
| `src/preload/index.ts` | мост renderer ↔ main; меняется только в тикете 02 |
| `src/shared/` | чистый TypeScript без Electron и `node:fs`: контракты IPC, типы, разбор, вычисления — всё, что тестируется unit-test-ами |
| `src/renderer/` | React: `shell/` (окно, sidebar, toolbar), `canvas/` (Холст, Узлы, рёбра, оверлеи), `session/` (транскрипт, поле ввода, правая панель), `markdown/`, `focus/`, `palette/`, `find/` |
| `src/card-runtime/` | скрипт, который worfy отдаёт внутрь каждой Карточки |
| `test/unit/`, `test/contract/`, `test/e2e/`, `test/fixtures/` | vitest unit, vitest contract, Playwright для Electron, данные |

**Точки расширения вместо центральных файлов.** Чтобы параллельные тикеты не правили одни и те же
файлы, новые части регистрируются сами, через `import.meta.glob`:

- канал IPC — новый файл `src/shared/ipc/<домен>.ts` (дополняет интерфейс `IpcContract`) и
  обработчик `src/main/ipc/<домен>.ts`;
- тип Узла — файл `src/renderer/canvas/nodes/<Тип>Node.tsx`;
- источник рёбер — `src/renderer/canvas/edges/<имя>.ts`;
- оверлей Холста — `src/renderer/canvas/overlays/<имя>.tsx`;
- раздел sidebar — `src/renderer/shell/sidebar/<Имя>Section.tsx`;
- элемент toolbar — `src/renderer/shell/toolbar/<Имя>.tsx`;
- бейдж на Тикете или Сессии — `src/renderer/canvas/badges/<Имя>.tsx`;
- действие на Тикете или Эпике — `src/renderer/canvas/actions/<Имя>.tsx`;
- блок правой панели Сессии — `src/renderer/session/rail/<Имя>.tsx`.

Соглашение вводят тикеты 02, 03, 05, 11 и 33; дальше центральные файлы не правятся.

**Агент в tests.** В CI настоящего Claude нет. Тикет 07 вводит `WORFY_AGENT=fake`: вместо SDK
`query()` подставляется stub, который проигрывает сценарий событий из
`test/fixtures/agent-scripts/*.jsonl`. Все e2e-tests с Сессиями работают на нём. Настоящий запуск
агента проверяется руками на репозитории самого worfy, вывод записывается в «Итог» тикета.

## Этапы

Каждый этап кончается рабочим приложением: его можно собрать, открыть и пользоваться тем, что
уже есть. Волны (ниже) идут поперёк этапов: тикет позднего этапа берётся раньше, если его
блокеры закрыты. Этап — это граница «что уже умеет приложение», а не очередь.

1. **Каркас** — 01–08, 32, 33. Окно macOS в двух темах, CI и собранный `.app`, выбор Проекта,
   пустой Холст с сохранением Раскладки, Оркестратор с живой SDK-сессией на настройках
   пользователя, его последний блок состояния на Узле, Session view с транскриптом и полем ввода.
2. **Workflow на холсте** — 09–17. Эпики рамками, Тикеты колонками по уровню зависимостей,
   готовая Волна подсвечена. Сессии, запущенные в терминале или Claude desktop, видны только
   для чтения. Дерево Subagent-ов, Привязки, бейджи Gate / PR / CI, Узел HANDOFF, ADR в sidebar.
   Проверяется на репозитории Auction (`/Users/alexey/Work/Auction`, 42 Эпика, 682 Тикета)
   строго на чтение: производительность здесь — требование, а не пожелание.
3. **Действия и контроль** — 18–23. Новые Сессии и Resume, поле ввода с моделью, effort,
   режимом разрешений, очередью, slash-командами и вложениями. Запрос разрешений
   Allow / Always allow / Deny, уведомления macOS, Лимиты. Кнопки «Ship ticket», «Run wave»,
   «Open PR».
4. **Карточки** — 24–26. MCP-сервер холста, рантайм Карточки на своём origin, API Карточки.
5. **Остальное** — 27–31. Терминал, focus mode, палитра ⌘K, поиск по Холсту, миникарта,
   закрепление и теги, корзина и undo Раскладки.

## Не в этом эпике

- Dock со встроенным браузером.
- Редактор `.env` проекта.
- Onboarding и приветственная Карточка.
- Swarm (раздача промптов группе Сессий).
- Управление с телефона (remote).
- Другие провайдеры моделей (Codex, OpenRouter, Grok).
- Несколько окон и вкладки.
- Отложенная отправка сообщений.
- Генераторы Карточек (скрипты на Node, которые переписывают Карточку): Карточка не получает Node.
- Нотаризация и подпись Apple: приложение личное, достаточно ad-hoc подписи.
- Запись статуса Тикета самим worfy в обход `ticket` и skills.
- Перенос Карточки в репозиторий Проекта и любая другая запись worfy в репозитории
  ([ADR-0005](../../docs/adr/0005-worfy-own-state-inventory.md)).
- Синхронизация состояния worfy (карточки, раскладка) с облаком — отдельная задача.
- Обобщение skill `/ship-ticket` в `~/.claude` под проекты кроме Auction — отдельная задача вне
  репозитория.

## Риски и открытые технические вопросы

1. **Hooks пользователя внутри SDK-сессии.** `~/.claude/hooks/stop.sh` блокирует конец хода
   (exit 2), пока у worktree красный маркер Gate, до двух раз за Сессию. Как это выглядит в
   потоке SDK (продолжение хода, `stop_hook_summary`, ошибка) — неизвестно. Отвечает тикет 06;
   тикет 07 обязан пережить два продолжения подряд и не застрять в `busy`.
2. **Окружение при запуске из Finder.** У приложения из Finder голый `PATH`: hooks зовут `node`,
   `pnpm`, `gh`. Нужен `PATH` из login shell (`$SHELL -lc env`). Отвечает тикет 06 отдельным spike-ом
   `scripts/spikes/path-probe/`, делает 07.
3. **Вход через подписку.** SDK запускает Claude Code. Из окружения нужно убрать
   `ANTHROPIC_API_KEY` и `ANTHROPIC_AUTH_TOKEN`, иначе вход пойдёт по ключу. Проверка — поле
   `apiKeySource` в сообщении `system/init`. Отвечает 06.
4. **Стабильность формата транскриптов.** `~/.claude/sessions/*.json` и
   `~/.claude/projects/<cwd>/<session>.jsonl` — внутренний формат Claude Code, он меняется от
   версии к версии. Разбор обязан терпеть неизвестные записи и поля, а fixtures — снимать
   несколько версий. Отвечает 09, делает 13.
5. **Сессии worfy видны и в реестре Claude Code.** Сессия, запущенная через SDK, тоже пишет
   транскрипт и, возможно, запись в `~/.claude/sessions`. Узел должен быть один: дедупликация по
   `sessionId`, своя Сессия главнее. Отвечает 06, делает 14.
6. **`rate_limits` в JSON status line.** Есть ли это поле на самом деле — не проверено. Первый шаг
   тикета 22. Если нет — Лимиты только из `rate_limit_event` SDK, и до первого хода в worfy
   данных нет.
7. **node-pty под Electron.** Нативный модуль пересобирается под ABI Electron
   (`@electron/rebuild`) и в сборке распаковывается из asar. Ставится в 32 (вторая Волна), чтобы
   поломка всплыла сразу, а не в 27. Test-ы идут под Node из Electron (`ELECTRON_RUN_AS_NODE=1`,
   тикет 01), поэтому грузят тот же бинарник, что и main.
8. **Производительность на Auction.** 682 Тикета, 883 транскрипта Subagent-ов. Нужны:
   `onlyRenderVisibleElements` React Flow, свёрнутые сделанные Эпики, инкрементальное чтение
   транскриптов (хвост файла, а не весь файл), debounce слежения за файлами. Пороги — в тикетах
   10, 11, 13.
9. **Уведомления от неподписанного приложения.** Electron `Notification` на macOS требует bundle
   id; из `pnpm dev` уведомления могут приходить от «Electron» или не приходить вовсе. Проверяется
   на собранном `.app` (тикет 21).
10. **Гонка записей в Раскладку.** Решена [ADR-0003](../../docs/adr/0003-cards-as-files-canvas-via-tools.md):
    пишет только main. Тикет 05 проверяет это contract test-ом с параллельными операциями.
11. **Agent SDK в собранном `.app`.** SDK запускает Claude Code дочерним процессом, а файл внутри
    `app.asar` запустить нельзя. Нужны `asarUnpack` для SDK, явные `pathToClaudeCodeExecutable` и
    `executable`. Делает 07, проверка — `init` в `.app`, запущенном из Finder.
12. **Как запускать «Ship ticket» и «Run wave».** Решено: шаблоны действий на проект. Каждый
    Проект хранит текст, который шлют действия (раздел «Шаблоны действий» выше); worfy только
    подставляет значения. Хранение и настройки — тикет 04, подстановка и действия — тикет 23.

## Соглашения для тикетов этого эпика

- **Сначала падающий test.** Каждый тикет начинается с test-а, который падает без изменения, и в
  «Итог» пишется, как он падал.
- **Виды test-ов.** Unit — vitest над `src/shared/`. Contract — vitest на границе: канал IPC,
  MCP-tool, сообщение Карточки, разбор файла Claude Code по fixture. E2e / smoke — Playwright
  `_electron` против собранного приложения, со `WORFY_DATA_DIR`, `WORFY_CLAUDE_HOME` во временной
  папке и `WORFY_AGENT=fake`.
- **Gate.** `bash ~/.claude/hooks/gate.sh fast </dev/null; echo $?` — `lint`, `typecheck`, `test`
  в корне (настройка — тикет 01). `full` добавляет `test:e2e`. Код 0 и строка `[gate] зелено` —
  единственный признак зелёного.
- **Только чтение чужих файлов.** worfy ничего не пишет в репозиторий Проекта и не пишет в
  `~/.claude`. Тикеты, которые читают эти места, проверяют это test-ом. Запись Gate в
  `~/.claude/gate/config.json` (тикет 01) — настройка разработки самого worfy, её делает
  разработчик, а не приложение; владелец её одобрил.
- **ADR.** Новые решения — `docs/adr/0006-…` и дальше (0006 — тикет 02), по одному решению на
  файл. Принятые ADR
  не правятся.
- **Worktree и ветки** — как в остальном workflow: `.claude/worktrees/<NN>-<slug>`, ветка
  `worfy-mvp/<NN>-<slug>`.
- Названия действий в UI — по-английски, как в [BRIEF.md](../../docs/design/BRIEF.md): «Ship
  ticket», «Run wave», «Open PR», «Resume», «Allow», «Always allow», «Deny».

## Волны

Волна — Тикеты, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в
коде» нет. Посчитано по `Blocked by` и спискам файлов ниже, все Тикеты открыты. Тикет 10
проверяет своё вычисление Волны на этой таблице — по копии эпика со статусами `open`
(`test/fixtures/worfy-mvp-epic/`), а не по живому `.scratch`.

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `package.json`, `electron.vite.config.ts`, `tsconfig*.json`, `eslint.config.js`, `vitest.config.ts`, `playwright.config.ts`, `src/main/index.ts`, `src/main/window.ts`, `src/main/storage/paths.ts`, `src/preload/index.ts`, `src/renderer/main.tsx`, `test/setup-dom.ts`, `test/e2e/helpers.ts`, `test/e2e/launch.spec.ts`, `.gitignore`, `~/.claude/gate/config.json` | 1 |
| 02 | `src/shared/ipc/channels.ts`, `src/shared/ipc/app.ts`, `src/preload/index.ts`, `src/main/ipc/index.ts`, `src/main/ipc/app.ts`, `src/main/index.ts`, `src/renderer/ipc.ts`, `docs/adr/0006-ipc-contract-by-declaration-merging.md` | 2 |
| 03 | `src/main/window.ts`, `src/renderer/theme/tokens.css`, `src/renderer/theme/primitives.tsx`, `src/renderer/shell/AppShell.tsx`, `src/renderer/shell/Sidebar.tsx`, `src/renderer/shell/Toolbar.tsx`, `test/e2e/theme.spec.ts` | 2 |
| 06 | `scripts/spikes/sdk-probe.ts`, `scripts/spikes/path-probe/`, `test/fixtures/sdk-messages/` | 2 |
| 09 | `scripts/spikes/claude-home-survey.ts`, `test/fixtures/claude-home/` | 2 |
| 32 | `.github/workflows/ci.yml`, `electron-builder.yml`, `package.json`, `test/contract/node-pty.test.ts`, `test/e2e/packaged.spec.ts` | 2 |
| 04 | `src/main/projects/store.ts`, `src/main/projects/settings.ts`, `src/shared/projects/action-templates.ts`, `src/main/storage/json-file.ts`, `src/shared/ipc/projects.ts`, `src/main/ipc/projects.ts`, `src/renderer/shell/sidebar/ProjectsSection.tsx`, `src/renderer/shell/ProjectSettings.tsx` | 3 |
| 07 | `src/main/agent/session.ts`, `src/main/agent/options.ts`, `src/main/agent/env.ts`, `src/main/agent/fake-query.ts`, `src/shared/agent/events.ts`, `src/main/ipc/agent.ts`, `src/shared/ipc/agent.ts`, `test/fixtures/agent-scripts/`, `electron-builder.yml` | 3 |
| 10 | `src/main/workflow/reader.ts`, `src/main/workflow/watch.ts`, `src/shared/workflow/types.ts`, `src/shared/workflow/waves.ts`, `src/shared/workflow/ticket-ref.ts`, `src/main/ipc/workflow.ts`, `src/shared/ipc/workflow.ts`, `test/fixtures/worfy-mvp-epic/` | 3 |
| 13 | `src/shared/transcript/parse.ts`, `src/main/claude-home/registry.ts`, `src/main/claude-home/tail.ts`, `src/main/ipc/claude-home.ts`, `src/shared/ipc/claude-home.ts` | 3 |
| 05 | `src/renderer/canvas/Canvas.tsx`, `src/renderer/canvas/nodes/index.ts`, `src/renderer/canvas/nodes/NoteNode.tsx`, `src/main/layout/store.ts`, `src/shared/layout/types.ts`, `src/main/ipc/layout.ts`, `src/shared/ipc/layout.ts` | 4 |
| 08 | `src/renderer/canvas/nodes/OrchestratorNode.tsx`, `src/main/agent/orchestrator.ts`, `src/shared/agent/status-block.ts` | 5 |
| 11 | `src/renderer/canvas/nodes/EpicFrameNode.tsx`, `src/renderer/canvas/nodes/TicketNode.tsx`, `src/renderer/canvas/epic-layout.ts`, `src/renderer/canvas/edges/blocking.ts`, `src/renderer/canvas/badges/index.ts`, `src/renderer/shell/sidebar/EpicsSection.tsx`, `src/shared/ipc/shell.ts`, `src/main/ipc/shell.ts` | 5 |
| 24 | `src/main/mcp/canvas-server.ts`, `src/shared/canvas/tools.ts`, `src/shared/cards/last-editor.ts`, `src/main/mcp/agent-instructions.md`, `src/main/agent/options.ts` | 5 |
| 25 | `src/main/cards/protocol.ts`, `src/main/cards/store.ts`, `src/renderer/canvas/nodes/CardNode.tsx` | 5 |
| 27 | `src/main/terminal/pty.ts`, `src/main/ipc/terminal.ts`, `src/shared/ipc/terminal.ts`, `src/renderer/canvas/nodes/TerminalNode.tsx` | 5 |
| 28 | `src/renderer/focus/FocusMode.tsx`, `src/renderer/focus/split-tree.ts`, `src/renderer/canvas/overlays/FocusEntry.tsx` | 5 |
| 29 | `src/renderer/canvas/overlays/MiniMapOverlay.tsx`, `src/renderer/canvas/overlays/SelectionToolbar.tsx`, `src/renderer/canvas/pinning.ts`, `src/renderer/canvas/tags.ts` | 5 |
| 33 | `src/renderer/session/SessionView.tsx`, `src/renderer/session/Transcript.tsx`, `src/renderer/session/MessageInput.tsx`, `src/renderer/session/rail/index.ts`, `src/renderer/markdown/Markdown.tsx`, `src/renderer/canvas/nodes/OrchestratorNode.tsx` | 6 |
| 12 | `src/renderer/canvas/nodes/HandoffNode.tsx`, `src/renderer/shell/sidebar/AdrSection.tsx`, `src/main/docs/watch.ts`, `src/main/ipc/docs.ts`, `src/shared/ipc/docs.ts` | 7 |
| 14 | `src/renderer/canvas/nodes/SessionNode.tsx`, `src/renderer/session/Transcript.tsx`, `src/renderer/shell/sidebar/SessionsSection.tsx` | 7 |
| 19 | `src/renderer/session/MessageInput.tsx`, `src/renderer/session/Pickers.tsx`, `src/main/agent/session.ts`, `src/main/agent/queue.ts`, `src/main/agent/fake-query.ts` | 7 |
| 22 | `src/main/agent/limits.ts`, `src/shared/agent/limits.ts`, `src/renderer/shell/toolbar/LimitsMeter.tsx`, `src/renderer/session/rail/LimitsRail.tsx`, `scripts/statusline-bridge.sh` | 7 |
| 15 | `src/shared/transcript/subagents.ts`, `src/renderer/canvas/nodes/SubagentNode.tsx`, `src/renderer/canvas/edges/subagents.ts`, `src/renderer/session/rail/SubagentsRail.tsx` | 8 |
| 17 | `src/main/gate/state.ts`, `src/main/github/prs.ts`, `src/main/ipc/checks.ts`, `src/shared/ipc/checks.ts`, `src/renderer/canvas/badges/ChecksBadges.tsx` | 8 |
| 18 | `src/renderer/canvas/nodes/SessionNode.tsx`, `src/renderer/session/HistoryPopover.tsx`, `src/renderer/shell/sidebar/SessionsSection.tsx`, `src/main/agent/resume.ts` | 8 |
| 20 | `src/renderer/session/MessageInput.tsx`, `src/renderer/session/SlashMenu.tsx`, `src/main/agent/commands.ts`, `src/main/agent/attachments.ts`, `src/main/agent/fake-query.ts` | 8 |
| 16 | `src/shared/binding/resolve.ts`, `src/main/layout/bindings.ts`, `src/renderer/canvas/edges/bindings.ts`, `src/renderer/session/rail/BindingRail.tsx` | 9 |
| 21 | `src/main/agent/permissions.ts`, `src/main/agent/options.ts`, `src/renderer/session/PermissionCard.tsx`, `src/renderer/session/Transcript.tsx`, `src/renderer/canvas/badges/NeedsPermission.tsx`, `src/main/agent/fake-query.ts`, `src/main/notify.ts` | 9 |
| 26 | `src/shared/cards/bridge.ts`, `src/renderer/canvas/card-bridge.ts`, `src/main/cards/data.ts`, `src/main/cards/protocol.ts`, `src/card-runtime/worfy-card.ts`, `src/main/mcp/agent-instructions.md` | 9 |
| 23 | `src/main/actions/launch.ts`, `src/shared/actions/render-template.ts`, `src/renderer/canvas/actions/TicketActions.tsx`, `src/renderer/canvas/actions/EpicActions.tsx`, `src/renderer/canvas/actions/OpenPr.tsx`, `src/shared/binding/resolve.ts`, `src/main/layout/bindings.ts` | 10 |
| 30 | `src/renderer/canvas/history.ts`, `src/main/layout/trash.ts`, `src/renderer/canvas/overlays/SelectionToolbar.tsx` | 10 |
| 31 | `src/renderer/palette/CommandPalette.tsx`, `src/renderer/palette/commands.ts`, `src/renderer/find/CanvasFind.tsx`, `src/renderer/find/search-index.ts` | 11 |

Общие файлы есть только у Тикетов разных Волн: `package.json` (01 → 32), `src/main/index.ts` и
`src/preload/index.ts` (01 → 02), `src/main/window.ts` (01 → 03), `electron-builder.yml` (32 → 07),
`src/main/agent/session.ts` (07 → 19), `src/main/agent/options.ts` (07 → 24 → 21),
`src/main/agent/fake-query.ts` (07 → 19 → 20 → 21), `src/renderer/canvas/nodes/OrchestratorNode.tsx`
(08 → 33), `src/renderer/session/MessageInput.tsx` (33 → 19 → 20),
`src/renderer/session/Transcript.tsx` (33 → 14 → 21), `src/renderer/canvas/nodes/SessionNode.tsx` и
`src/renderer/shell/sidebar/SessionsSection.tsx` (14 → 18), `src/shared/binding/resolve.ts` и
`src/main/layout/bindings.ts` (16 → 23), `src/main/mcp/agent-instructions.md` и
`src/main/cards/protocol.ts` (24/25 → 26), `src/renderer/canvas/overlays/SelectionToolbar.tsx`
(29 → 30). Внутри одной Волны общих файлов нет. Всего Волн — 11.
