# Product Session и Mind map: на чём строить и чего нет

- **Дата:** 2026-11-07
- **Карта:** [`.scratch/worfy-product/`](../../.scratch/worfy-product/map.md), Ticket 07 (research). Решения 01–06 карты —
  исходные: Product Session (вид Session-советника, который не меняет код), Mind map (живая схема из узлов Идея, Вопрос,
  Решение, Возражение), экран Mind map 60 / чат 40 и прототип в Card.
- **Статус:** исследование, не решение. Ticket-ов не заводит. Оценка размера (раздел 5) — предположение.
- **Вопрос.** Что в worfy уже есть, на чём Product Session с живой Mind map может стоять, и чего не хватает.
- **Ответ коротко.**
  - **Вида Session нет.** Session — одна схема данных и один экран. Orchestrator (главная Session Project-а) отличается
    только флагом `orchestrator: true`, а он выбирает лишь окно autocompact. Product Session нужно новое поле вида у Session
    и ветка экрана в одном месте — `SessionPanel`.
  - **Свои правила подать можно уже сейчас:** у Claude — `systemPrompt.append`, у Codex — `developerInstructions`.
    Но правила Orchestrator-а hook `SessionStart` Harness-а кладёт в каждую главную Session без условий. Product Session
    получит их тоже, пока hook не научится выбирать набор правил по виду Session.
  - **Ограничить tools по пути сейчас нечем.** Главная Session не передаёт ни `allowedTools`, ни `disallowedTools`.
    Session без человека идёт в `bypassPermissions`, где callback разрешений почти не зовётся. Auto-approval judge
    (проверка запросов разрешения в Autopilot) правил на Session не принимает. Allowlist MCP-серверов (ADR-0021) задан
    на Project и на сервер целиком, а не на Session и не на отдельный tool.
  - **Инструмент для Mind map почти готов по образцу `worfy-canvas`:** zod-схемы, одна таблица handler-ов, нейтральное
    описание `McpServer`, которое оба Vendor-а уже умеют подать: Claude — в процессе, Codex — по HTTP на 127.0.0.1.
  - **Живая перерисовка из файла `docs/product/<тема>/`:** готового watcher-а нет. Watcher документов (`src/main/docs/watch.ts`)
    уже держит рекурсивный watch корня Project-а, но события вне HANDOFF и ADR отбрасывает по имени. Расширить его дешевле,
    чем заводить новый. Для Windows есть готовые обходы.
  - **Card как первый выпуск** работает только как прототип. Card не читает файлы Project-а. Схема жила бы в папке
    данных worfy, а не в `docs/product/`. Чат рядом даёт только Focus mode, и его деление не сохраняется.
- **Как проверено.** Только чтение кода на `839f6740a` в отдельном worktree. Три scout-агента собрали факты, каждая
  ссылка `file:line` ниже перечитана по файлу. Приложение не запускалось, pnpm не вызывался, бинарник Codex не
  запускался.

## 1. Экран Session сегодня

### 1.1. Как показана Session

- **Полный экран.** `src/renderer/main.tsx:92` передаёт оболочке `session={<SessionView … />}`. Цепочка:
  `SessionView` (`src/renderer/session/SessionView.tsx:345`) → `ProjectSessionView` (`:358`) → `SessionPanel` (`:376`,
  определён на `:140`).
- **Что внутри `SessionPanel`.** Header (`SessionView.tsx:248`), затем `w-session__body` (`:320`). В нём `w-session__main`
  с `Transcript` и `MessageInput` (`:321-337`) и правая колонка `SessionRail` (`:339`).
- **Какая Session на экране.** По умолчанию — Orchestrator: `const nodeId = opened !== null ? opened.nodeId : orchestrator`
  (`SessionView.tsx:362`). Session, запущенная вне worfy, идёт в `ExternalSessionPanel` только для чтения (`:364-366`).
- **Canvas и Session — два вида одной оболочки.** `src/renderer/shell/AppShell.tsx:99-104`: все виды смонтированы,
  неактивный скрыт (`hidden={view !== 'session'}`). Тип вида — `'canvas' | 'session' | 'pipeline' | 'history'`
  (`src/renderer/shell/Toolbar.tsx:17`). Текущий вид держит zustand-store только в памяти
  (`src/renderer/session/navigation.ts:44`; «nothing of it is saved», `:8`). `openSession` переключает на `'session'`
  (`navigation.ts:92-99`).
- **Node на Canvas.** `SessionNode` (`src/renderer/canvas/nodes/SessionNode.tsx:70`, `kind = 'session'`) и
  `OrchestratorNode` (`OrchestratorNode.tsx:28`, `kind = 'orchestrator'`). Session Node показывает последний ответ и поле
  ввода (`SessionNode.tsx:52-56`, форма на `:485-503`). Двойной click открывает полный экран (`SessionNode.tsx:391-393`).
  Виды Node-ов собираются через `import.meta.glob`: новый вид не правит ни реестр, ни `Canvas.tsx`
  (`src/renderer/canvas/nodes/index.ts:13-14`).

### 1.2. Панель агентов и привязанный Epic

- **Панель — правая колонка экрана Session, не sidebar приложения.** Локальный `SessionRail` в
  `SessionView.tsx:105-116` (`<aside className="w-session__rail" aria-label="Session details">`). Его копия
  `src/renderer/session/SessionRail.tsx` используется только в `ExternalSessionPanel`.
- **Блоки панели** собираются glob-ом: `src/renderer/session/rail/index.ts:46`. Порядок: Vendor (`VendorRail.tsx:14`,
  `order = 5`; для Orchestrator-а пусто, `:25`), Binding (`BindingRail.tsx:17`, `order = 10`), Subagents
  (`SubagentsRail.tsx:39`, `order = 20`).
- **Привязанный Epic** (Binding — то, к чему привязана Session: Ticket или Epic) рисует `BindingRail`
  (`rail/BindingRail.tsx:91`). Кнопка «Show on Canvas» — `focusEpic(projectId, binding.target.epic)` (`:114`).
- **Свернуть панель нельзя.** `.w-session__rail { width: 300px; flex: none; }` (`src/renderer/session/session.css:308-310`).
  Ни кнопки, ни разделителя, ни сохранённого состояния нет.
- **Sidebar приложения** — другое: он прячется целиком (`AppShell.tsx:91`, Cmd/Ctrl+B), его секции сворачиваются и
  запоминаются в app settings (`src/shared/settings/app-settings.ts:264-267`).

### 1.3. Как собран layout

- Оболочка: `AppShell.tsx:90-111` — `w-shell` → `Sidebar` + `w-shell__main` → `Toolbar` + `main` с четырьмя слотами вида.
- Тело Session — обычный flex-ряд без разделителя: `.w-session__body { flex: 1; min-height: 0; display: flex; }` и
  `.w-session__main { flex: 1 1 auto; min-width: 0; … }` (`session.css:216-228`).
- **Общего компонента resizer нет**, библиотеки split pane в `package.json` нет (зависимости — `package.json:28-52`).
  Единственный перетаскиваемый разделитель — в Focus mode: разметка `src/renderer/focus/FocusMode.tsx:581-596`
  (`role="separator"`), логика drag — `:462-480`, математика — `moveDivider` (`src/renderer/focus/split-tree.ts:186`),
  минимум доли — `MIN_SHARE = 0.1` (`:47`). Деление Focus mode не сохраняется: «kept only in memory … never saved»
  (`FocusMode.tsx:7-8`).
- **Где запомнить положение разделителя.** Два готовых места:
  - app settings — один файл на Machine, общий для всех окон; схема `appSettingsSchema` (`app-settings.ts:262`);
  - localStorage окна — так экран Session уже помнит «скрыть tools» (`src/renderer/session/transcript-view.ts:23`,
    `PREFIX = 'worfy.transcript.hideTools:'`).
- **Отрисовка графа уже есть в зависимостях.** `@xyflow/react` 12.12.0 (Canvas) и `elkjs` 0.12.0 (`package.json:35`,
  `:39`). ELK раскладывает Epic frame-ы в Web Worker (`src/renderer/canvas/elk/client.ts:18-19`). *Предположение:* Mind
  map можно рисовать тем же React Flow, а раскладку дерева «из чего выросло» поручить ELK.

### 1.4. Есть ли «вид Session» или роль

- **Нет.** У Session Node в данных только `origin`, `vendor`, `sessionId` (`src/shared/ipc/sessions.ts:24-33`). Вид
  Session на экране несёт `vendor` (`sessions.ts:73`). Разница Session и Orchestrator-а — только вид Node-а:
  `SESSION_NODE_KIND = 'session'` (`sessions.ts:18`) и `ORCHESTRATOR_KIND = 'orchestrator'`
  (`src/shared/ipc/orchestrator.ts:20`).
- **В main Orchestrator — флаг, не вид.** `SessionLaunch.orchestrator?: boolean` (`src/main/agent/session-settings.ts:31-39`)
  ставится в `src/main/agent/orchestrator.ts:713` и читается в одном месте — окно autocompact
  (`src/main/vendors/claude/query.ts:166`).
- **На экране Orchestrator — тот же `SessionPanel`.** Меняются только слова и значки: заголовок `'Orchestrator'` или
  `'Session'` (`SessionView.tsx:212`), Vendor `null` для Orchestrator-а (`:216`), подпись `'orch'` (`:218`).
- **Vendor** — `['claude', 'codex']` (`src/shared/vendors/vendor.ts:6`). ADR-0094 требует, чтобы интерфейс читал только
  флаги capabilities, без проверок `vendor === 'claude'` (`docs/adr/0094-vendor-seam.md:33-36`).
- **Terminal AI — не Session** (`CONTEXT.md:296`): транскрипта, Node-а и Binding-а у него нет.
- **Вход «New session».** IPC-канал `sessions.new` с входом `{ projectId, vendor? }` (`src/shared/ipc/sessions.ts:96`),
  handler — `sessions().open(projectId, vendor)` (`src/main/ipc/sessions.ts:13`), создание Node-а —
  `node-sessions.ts:166`, `:193`, данные Node-а — `{ origin: 'worfy', vendor }` (`src/main/agent/node-sessions.ts:201`).
  Входы в интерфейсе — sidebar (`src/renderer/shell/sidebar/SessionsSection.tsx:92-101`) и Command palette
  (`src/renderer/palette/commands.ts:171-180`, `id: 'new:session'`).

### 1.5. Что нужно для второго вида Session с другим layout

*Предположение — план по фактам выше, не проверенный кодом.*

1. **Хранить вид.** Необязательное поле, например `kind: 'product'`, в `worfySessionNodeDataSchema` (`sessions.ts:24`) и
   в `sessionNodeViewSchema` (`:69`). Второй путь — свой вид Node-а `product-session`. Это новый файл в
   `canvas/nodes/`, но тогда нужна поддержка в main и в `nodeSession()`, который для чужих видов даёт `null`.
2. **Создавать.** Добавить вид во вход `sessions.new` и провести его через `NodeSessions.open/create` и `SessionLaunch`.
3. **Входы.** Команда «New Product Session» рядом с `new:session` и пункт рядом с выбором Vendor-а в sidebar.
4. **Layout.** Ветка в `SessionPanel` вместо `w-session__body` (`SessionView.tsx:320`) или отдельный `ProductSessionPanel`
   из `ProjectSessionView` (`:376`). Header остаётся общим. Блоки панели уже приходят prop-ом `blocks`, поэтому
   спрятать Binding — значит передать отфильтрованный список.
5. **Разделитель.** Свой маленький компонент. Логику drag берём из `FocusMode.tsx:462-480`, долю сохраняем в app settings
   или в localStorage.
6. **Панель иконками.** Сворачивания нет нигде. Нужны новое состояние и CSS для `.w-session__rail`.

## 2. Правила на Session

### 2.1. Hook-и Harness-а

- **Правила Orchestrator-а идут в каждую главную Session без условий.** `harness/hooks/hooks.json:9`:
  `inject-rules.mjs orchestrator` в `SessionStart` без matcher-а. Common — `:18`. Subagent-ы получают только common
  (`hooks.json:51-56`, `SubagentStart`).
- **Набор правил выбирает только аргумент командной строки.** `harness/hooks/inject-rules.mjs:33`
  (`process.argv[2]`) и `:38` (`rules/${part}.md`). Переменной окружения или метки нет. К common добавляются правила
  пользователя (`:67`).
- **По Project-у, а не по Session.** `session-start.mjs` добавляет `rules.md` профиля, если в профиле включено
  `inject_rules` (`harness/hooks/session-start.mjs:138`, `:172-192`).
- **Третий набор.** Файл `rules/product.md` загрузился бы командой `inject-rules.mjs product`: имя проверяется только на
  `/`, `\` и точку в начале (`:35`). Но команды `hooks.json` статичны и одни на все Session. *Предположение:* hook
  мог бы читать переменную вида Session, которую worfy задаёт в `options.env` (`options.ts:530`). Тогда Product Session
  получала бы `product`, а не `orchestrator`. Получает ли процесс hook-а окружение Session — не проверено.
- **Codex — тот же `hooks.json`** (`hooks.json:2`). Но hook-и Harness-а у Codex выключены, пока пользователь не одобрит
  их в Codex (`src/main/vendors/codex/harness-hooks.ts:2-4`). Событие `sessionStart` Codex знает (`:59`).

### 2.2. Как app передаёт настройки Agent SDK (Claude)

`sessionOptions` (`src/main/vendors/claude/options.ts:526-591`) вызывается из `sdkQueryFactory`
(`src/main/vendors/claude/query.ts:147-170`).

- `settingSources: ['user', 'project', 'local']` (`options.ts:531`).
- `systemPrompt` — preset `claude_code` (`:532`). `append` получает только текст MCP-серверов Canvas и Browser (`:581`):
  `src/main/mcp/agent-instructions.md` и инструкции Browser.
- `permissionMode` — `bypassPermissions` для Session без человека, иначе настройка пользователя (`:533`; правило —
  `session-settings.ts:56-57`).
- `canUseTool` (`:556`), `hooks` (`:557`), `disallowedTools` (`:559`), `allowedTools` (`:560`). **Главная Session ни
  `allowedTools`, ни `disallowedTools` не передаёт**: в вызове `query.ts:147-170` их нет.
- PreToolUse hook worfy только наблюдает и всегда отвечает `{}` (`options.ts:325-335`).
- MCP: `managedSettings.allowedMcpServers` из allowlist-а (`:561-564`), серверы — `:572`, `:577`, `:586`, `:589`.
  Allowlist читается из профиля Project-а (`query.ts:61`).
- `managedSettings.allowManagedPermissionRulesOnly` уже умеет включать черновик профиля Project-а
  (`permissionRulesFromPolicyOnly`, `options.ts:566`, `:431`). *Предположение:* тот же `managedSettings` мог бы нести
  правила deny для Product Session.
- `env` — окружение login shell (`:530`). Своих переменных на Session (вроде `WORFY_ORCHESTRATOR`) нет.

### 2.3. Codex

- Старт thread-а: `cwd`, `approvalPolicy`, `sandbox`, `config`, `developerInstructions`
  (`src/main/vendors/codex/session.ts:783-790`). `developerInstructions` — только инструкции MCP-серверов
  (`src/main/vendors/codex/mcp.ts:161`).
- Presets: read-only = `on-request` + `read-only`; auto = `on-request` + `workspace-write`; full-access = `never` +
  `danger-full-access` (`src/main/vendors/codex/capabilities.ts:26-44`). Соответствие режимам Claude — `:59-62`.
  `workspaceWrite` с `writableRoots: []` (`:98`).
- MCP — по ключу на сервер, `mcp_servers.<name>` с URL и token-ом (`codex/mcp.ts:154`), только из allowlist-а (`:146-147`).
- Approval-ы Codex — только на команду и на правку файла (`src/main/vendors/codex/approvals.ts:1-3`).

### 2.4. Механизмы ограничения tools

| Механизм | Где | Годится для Product Session? |
|---|---|---|
| `allowedTools` / `disallowedTools` | поддержаны в `options.ts:559-560`. Используют только одиночные запросы: `ONE_SHOT_DISALLOWED_TOOLS` (`src/main/vendors/claude/one-shot.ts:64-76`) | *Предположение:* `disallowedTools: ['mcp__worfy-canvas__autopilot_start']` убирает Autopilot. Правила вида `Edit(путь)` в этом поле — синтаксис Claude Code, в worfy не проверен |
| Permission callback `canUseTool` | `options.ts:556`. Позволяет «один раз» или «всегда» по имени tool (`src/main/agent/permissions.ts:6-14`) | Путей не смотрит. В `bypassPermissions` Claude Code зовёт его только на немногие свои проверки (`src/main/vendors/claude/session.ts:174-175`) |
| Auto-approval judge | `judge` (`src/main/agent/auto-approve/policy.ts:272`), roots Run-а — worktree-ы Wave, `.scratch`, TMPDIR, scratchpad (`auto-approve/roots.ts:5-8`) | Работает только в Autopilot. Правил на Session в `PolicyContext` нет (`policy.ts:51` и далее) |
| MCP allowlist (ADR-0021) | профиль Project-а, по умолчанию `qmd` и `worfy-canvas` (`docs/adr/0021-mcp-servers-allowlist-in-profile.md:12-17`). Claude — `options.ts:561-564`, Codex — `codex/mcp.ts:146-147` | Целым сервером и на весь Project. `autopilot_start` живёт в том же `worfy-canvas`, что и `create_card` |
| Нет обработчика `autopilot_start` | tool отказывает, если `context.autopilotStart` не задан (`src/main/mcp/canvas-server.ts:295`). Сейчас обработчик один на все Session (`:470-474`) | *Предположение:* не давать его Product Session. Работает для обоих Vendor-ов, потому что сервер один |
| `guard.mjs` (PreToolUse Harness-а) | matcher `Bash\|apply_patch` (`hooks.json:146`). Есть прецедент запрета правок по виду агента: `apply_patch` для `worfy-reviewer` и `worfy-scout` на Codex (`harness/hooks/guard.mjs:64-69`) | *Предположение:* правило «правки только в `docs/product/`, без ticket CLI» по виду Session. Сейчас guard вида Session не знает |
| Без tools совсем | Terminal AI: `settingSources: []`, `mcpServers: {}`, `tools: []`, `permissionMode: 'dontAsk'` (`src/main/vendors/claude/terminal-ai.ts:42-46`) | Не годится: Product Session нужны Read, Write в `docs/product/` и tool Mind map |

**Вывод.** Свои правила Product Session сейчас подаются у обоих Vendor-ов: `systemPrompt.append` и `developerInstructions`.
Мешают только правила Orchestrator-а, которые приходят всем. Ограничения требуют новой проводки: вид Session должен
дойти из renderer до настроек SDK, до `canvasServer` и до hook-ов Harness-а.

- Запрет Autopilot делается проще всего: убрать обработчик `autopilot_start` (Claude и Codex) или добавить
  `disallowedTools` (только Claude).
- Запрет правок вне `docs/product/` надёжно держит только hook. У Claude это может быть PreToolUse hook worfy
  (`options.ts:325`), который научится отвечать deny. У Codex — `guard.mjs`, и только после одобрения hook-ов.
- Ticket CLI через Bash надёжно не закрыть: шаблон команды обходится. *Предположение:* честнее записать его в правила
  Session как запрет и проверять guard-ом лишь известные пути `bin/`.

## 3. Tool, которым агент меняет Mind map

### 3.1. Как устроен `worfy-canvas` от вызова до экрана

1. **Схемы.** Аргументы каждого tool — zod raw shape в `src/shared/canvas/tools.ts:99-118`. Проверка —
   `parseToolArgs` (`:127-128`). Файл назван публичным контрактом, менять его вместе с инструкциями агента (`:3-5`).
2. **Нейтральное описание сервера.** `McpTool { name, description, shape, call }` и `McpServer { name, version, tools }`
   (`src/main/vendors/mcp.ts:26-39`). Доставка `'inProcess' | 'http'` (`:12`).
3. **Сервер.** `canvasServer()` строит tools из `CANVAS_TOOL_NAMES` (`src/main/mcp/canvas-server.ts:329-335`).
   `canvasToolCaller` повторно разбирает аргументы и превращает ошибку в результат `isError`, без исключения (`:314-326`,
   helper `text` — `:138-141`).
4. **Транспорт Claude** — SDK-сервер в процессе: `createSdkMcpServer` (`src/main/vendors/claude/mcp.ts:23-28`),
   подключение — `options.ts:570-575`.
5. **Транспорт Codex** — stateless streamable HTTP на `127.0.0.1`: каждый JSON-RPC — POST
   (`src/main/mcp/http-server.ts:20-24`). Запрос с заголовком `Origin` получает 403 (`:162-164`). Token на Session
   передаётся через `WORFY_MCP_TOKEN` (`codex/mcp.ts:31`, `:154`).
6. **Main.** Каждый handler зовёт `layout.apply(projectId, op)` (`canvas-server.ts:193-196`). `apply` ещё раз
   проверяет операцию схемой, поднимает `revision`, планирует запись и зовёт listener-ов
   (`src/main/layout/store.ts:427-447`). Запись в `layout.json` отложена: 250 мс, но не дольше 1000 мс (`:66`, `:72`).
   Main — единственный писатель (`store.ts:1-5`).
7. **Renderer.** `store.onChange` → `toEveryWindow(… emit(client, layoutChanged, …))` (`src/main/ipc/layout.ts:18-20`).
   Канал — `layout.changed` (`src/shared/ipc/layout.ts:74`). Подписка — `src/renderer/canvas/useLayout.ts:47`.
8. **Ответ агенту** — JSON одним текстовым блоком (`canvas-server.ts:321`, `:138-141`).

### 3.2. Что переиспользует набор `mind_map_*`

- Пары схема + описание в `src/shared/` по образцу `canvas/tools.ts`. Проверка формата идёт в handler-е до записи
  (решение 05, Q3).
- Таблица handler-ов и caller с повторным разбором и `isError` (`canvas-server.ts:314-326`).
- Описание `McpServer`: оба Vendor-а подают его без новой проводки. Claude — через `claudeMcpServer`, Codex — через
  `endpoint.grant(...)` (`codex/mcp.ts:151`).
- *Предположение — два пути:*
  - добавить tools в `worfy-canvas`: allowlist и подключение не меняются, но tools Mind map получит каждая Session;
  - отдельный сервер `worfy-mind-map`: нужна своя запись в allowlist профиля (ADR-0021) и своё подключение, как у
    `worfy-browser` (`options.ts:577`). Зато сервер можно давать только Product Session.
- **Чего нет.** Tools `worfy-canvas` пишут в `layout.json` — состояние worfy в папке данных (ADR-0005), а не файл
  Project-а. Mind map по решению 05 — файл в `docs/product/<тема>/`. Значит, handler пишет файл Project-а. Канал «tool →
  файл → renderer» нужно строить заново, `layout.changed` его не покрывает.

### 3.3. Watcher файла и живая перерисовка

- **chokidar** — `5.0.0` (`package.json:38`). Используется в Cards (`src/main/cards/store.ts:273`), workflow
  (`src/main/workflow/watch.ts`) и claude-home (`src/main/claude-home/registry.ts:28`).
- **Watcher документов** (`src/main/docs/watch.ts`). Один рекурсивный `fs.watch` корня Project-а (`:183-184`). Читает
  только `HANDOFF.md` и `docs/adr/NNNN-*.md` (`isDocument`, `:54-57`). Прочие пути отбрасывает по имени до чтения
  (`:342-352`), а чтение вне них отклоняет (`:91`). Debounce — 50 мс (`:433`). Один watcher на Project — `DocsHub`
  (`:482`).
- **Канал в renderer.** Событие `docs.changed` (`src/shared/ipc/docs.ts:72`), подписка — `src/renderer/docs/useDocs.ts:41`.
- *Предположение:* `docs/product/<тема>/<файл>` проще всего добавить в `isDocument` и в фильтр путей этого watcher-а.
  Событие файловой системы уже доходит до него и только отбрасывается. Тогда правку файла руками или чужим агентом
  экран увидит так же, как правку через tool.
- **Оговорки для Windows (из кода).**
  - `fs.watch` удалённой папки на Windows не закрывается и шлёт 87 000–147 000 событий в секунду; обход — в
    `src/main/watch-gone.ts:5-9`.
  - chokidar на Windows читает каждую ссылку, и ссылка на `\\host\share` отправляет учётные данные пользователя по SMB.
    Поэтому Cards и Tickets root на Windows смотрит `src/main/link-safe-watch.ts`, а не chokidar (`:3-9`;
    `cards/store.ts:231-232`; `workflow/watch.ts:33-36`).
  - chokidar 5.0.0 может снова открыть watch после `close()` и бросить EPERM, пока Windows удаляет папку. Закрывать
    только через `closeForGood` (`src/main/chokidar-close.ts:7-15`).
  - chokidar 5.0.0 молча теряет второе изменение файла в течение 50 мс после первого (`claude-home/registry.ts:755-759`).
    Для Mind map это значит: две быстрые записи tool-а подряд могут дать один кадр со старым файлом. Watcher документов
    идёт через `fs.watch`, не через chokidar, и такой потери у него нет — *вывод по коду, test-ом не проверено*.
  - «chokidar hold» в памяти Orchestrator-а (`owner-decisions-2026-10-21.md`, пункт 8) — пауза на публичный issue в
    chokidar, а не запрет на сам chokidar.

## 4. Card как короткий путь

Может ли первый выпуск быть Card плюс MCP tool вместо нового вида Session? Для прототипа (Ticket 06) — да. Для
продукта по решениям 04–05 — нет. Ограничения:

- **Card не читает файлы Project-а.** API — пять операций: `data.get`, `data.set`, `session.ask`, `workflow.get`,
  `workflow.subscribe` (`src/shared/cards/bridge.ts:48-53`). «A Card has no other way to reach worfy, files or other
  Cards» (`src/main/mcp/agent-instructions.md:13-14`). CSP — `default-src 'self'`, `connect-src https:`
  (`src/main/cards/protocol.ts:53-63`); `fetch` своих же файлов тоже закрыт (`docs/features/cards.md:43`). Значит, файл
  в `docs/product/<тема>/` Card не увидит.
- **Живые данные приходят только двумя путями.**
  - Push — только снимок workflow (`src/card-runtime/worfy-card.ts:91-93`).
  - Перезагрузка всей страницы при записи файла в папку Card: в течение секунды, после 100 мс тишины
    (`docs/features/cards.md:29-30`; `CARD_CHANGE_DELAY_MS = 100`, `src/main/cards/store.ts:37`). Агент пишет, например,
    `data.js` в папку Card, и Card перерисовывается. Но перезагрузка теряет состояние страницы (масштаб, прокрутку,
    выбранный узел).
  - `data.set` другим событий не шлёт; `data.get` читает файл заново при каждом вызове (`src/main/cards/data.ts:25-26`).
    *Предположение:* Card может опрашивать `data.get`, но писать в `card-data/` агенту нечем — это папка данных worfy
    (`data.ts:2`).
- **Схема жила бы вне Project-а.** Папка Card лежит в данных worfy, а не в репозитории. Это противоречит решению 05 Q3:
  Mind map — файл в `docs/product/<тема>/`.
- **Чат рядом — только через Focus mode.** Preset «Main + side» даёт первому tile левые 2/3 (`docs/features/focus-mode.md:49`).
  В tile Session Node — это последний ответ и поле ввода, а не полный транскрипт. Деление Focus mode не сохраняется
  (`FocusMode.tsx:7-8`).
- **Ограничений Product Session Card не даёт.** Session рядом с Card — обычная Session с правилами Orchestrator-а и всеми
  tools.
- **Что Card даёт.** Нулевой код в worfy для прототипа экрана. Проверку формата файла и операций tool-а можно
  примерить, пока агент правит `data.js` своими инструментами.

## 5. Оценка размера

*Всё в этом разделе — предположение.* Размер Ticket-а — как у Ticket-ов Epic-ов worfy последних недель: один PR,
test-ы, review.

| Часть | Что входит | Ticket-ов |
|---|---|---|
| (a) Harness | `rules/product.md` и выбор набора правил по виду Session в `inject-rules.mjs`, без правил Orchestrator-а (1). Агент-критик `harness/agents/critic.md` плюс TOML для Codex (1). Skill критики плана и pre-mortem (1–2). Правило `guard.mjs` для Product Session: правки только в `docs/product/`, без известных путей ticket CLI (1) | 4–5 |
| (b) Вид Session и ограничения | Поле вида в данных Node-а, `sessions.new`, `SessionLaunch` (1). Настройки Claude: свои правила, `disallowedTools`, deny в PreToolUse hook (1). Codex: `developerInstructions`, preset, guard (1). Без обработчика `autopilot_start` (входит в Claude или в Codex). Входы «New Product Session» в sidebar и Command palette (1) | 4 |
| (c) Tool и файл Mind map | Формат файла и zod-схема в `src/shared/`, ADR о формате (1). Сервер `mind_map_*` с проверкой и записью файла (1–2). Watcher `docs/product/` и IPC-канал (1) | 3–4 |
| (d) Экран | `ProductSessionPanel` с разделителем 60/40 и сохранённой долей (1). Отрисовка Mind map на React Flow + ELK (1–2). Панель агентов в полосу иконок, Binding скрыт (1) | 3–4 |

Итого 14–17 Ticket-ов. Wave-ы Harness-а (a) не зависят от (b)–(d), и pilot критика на roadmap worfy может начаться на
них одних (решение 05, Q6). Но без (b) это обычная Session с правилами Orchestrator-а: граница решения 04 тогда держится
только словами правил.

## Что не проверено

- Получает ли процесс hook-а `SessionStart` окружение, которое worfy передаёт в `options.env`. От этого зависит выбор
  набора правил по переменной.
- Работают ли правила вида `Edit(docs/product/**)` в `disallowedTools` Agent SDK 0.3.289 и в `bypassPermissions`.
- Уходит ли `canUseTool` в `bypassPermissions` дальше, чем на несколько проверок Claude Code, — взято из комментария
  `session.ts:174-175`, не из запуска.
- Потеря второго изменения за 50 мс описана для chokidar. Что `fs.watch` watcher-а документов ведёт себя иначе на macOS,
  Windows и Linux, test-ом не проверено.
- Как Mind map на 100+ узлах ведёт себя в React Flow и ELK — не мерили (вопрос открыт и в карте).
- Codex: `baseInstructions` в протоколе есть, worfy его не задаёт; заменяет ли он системный prompt Codex целиком — не
  проверено. Бинарник Codex не запускался.
- Приложение не запускалось. Всё о поведении экрана — по коду и страницам `docs/features/`.
