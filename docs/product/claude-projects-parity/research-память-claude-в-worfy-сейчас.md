# Память Claude в worfy сейчас: код, runtime и диск

- **Дата:** 2026-11-28. Код — коммит `c66e7215a` основного checkout. Снимок диска — 2026-11-28, около 03:19 UTC.
- **Вопрос:** на что из «Discovery spike (blocking)» раздела «P0 — Native Memory Integration (Claude first)» в PR #2270
  уже можно ответить чтением. PR #2270 — это предложение о паритете worfy с Claude Projects: файл
  `docs/claude-projects-parity-proposal.md` на ветке `docs/claude-projects-parity-native-memory`, spike — строки 56–66.
- **Метод:** только чтение. Код — `git show c66e7215a:<путь>`. Runtime — фрагменты внутри бинарника Claude Code из
  установленной Stable copy, команда `grep -a -b -o -F '<фрагмент>' <файл>` (число — смещение в байтах). Диск — счёт
  файлов, даты и имена полей, без содержимого. Ни Claude Code, ни worfy не запускались.
- **Соседняя заметка:** что пишет документация Anthropic, собрано в `research-claude-projects-и-память-claude-code.md`
  этой же папки. Здесь — как это устроено в коде worfy, в установленном runtime и на диске этого Mac.

Обозначения:

- `<claude>` — `~/Applications/worfy-stable.app/Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`.
  Это бинарник Claude Code 2.1.322, который запускает Stable copy. `<claude>@N` — фрагмент по смещению N.
- `<app.asar>` — `~/Applications/worfy-stable.app/Contents/Resources/app.asar`. Внутри — JS SDK 0.3.322.
- `<ключ основного checkout>` — имя папки основного checkout под `~/.claude/projects/`. Это его абсолютный путь, где
  каждый символ кроме латинских букв и цифр заменён на `-`.
- `<память>` — `~/.claude/projects/<ключ основного checkout>/memory/`.
- Код runtime минифицирован. Имена вроде `Ih` или `gy` — имена в бинарнике. Одно имя встречается в разных модулях; я
  брал определение рядом с местом вызова. Уверенность: высокая для констант и строк, средняя-высокая для цепочек вызовов.

## Коротко

1. Встроенная auto memory **уже работает** в обычных Session, Orchestrator, Product Session и Autopilot. Все они идут
   через `sessionOptions()`: preset `claude_code`, `settingSources` user + project + local, cwd — корень Project
   (`src/main/vendors/claude/options.ts:788-795`, `src/main/vendors/claude/query.ts:442-479`). Ничто в worfy, в
   настройках или в shell-файлах этого Mac её не выключает (раздел 1.3).
2. История это подтверждает. Все 33 transcript-а Session через Agent SDK в ключе основного checkout несут в блоке
   инструкций файл типа `AutoMem` — это `<память>MEMORY.md` (раздел 3.3).
3. Папку памяти runtime считает от **канонического git root**. Linked worktree получает папку основного checkout
   (`<claude>@263970037`, `<claude>@262003405`). На диске ни у одного из 24 ключей `.claude/worktrees/*` нет папки
   `memory`. При этом Session из этих worktree грузили `MEMORY.md` основного checkout и записали туда 51 файл.
4. В `<память>` 177 файлов: `MEMORY.md` и 176 файлов тем. Индекс — 107 строк и 15 369 знаков. Предел — 200 строк и
   25 000 знаков (`<claude>@264886747`). Сейчас индекс не обрезается. 2026-11-23/24 он обрезался в 19 transcript-ах.
5. **Product Session не может записать память** через Write или Edit. Её PreToolUse guard закрывает всю папку Claude
   home (`src/main/vendors/claude/query.ts:297-305`, `src/main/agent/product-guard.ts:19-21`, `:212`). Сам runtime
   такую запись разрешает без вопроса (`<claude>@266470750`). В transcript-ах виден один такой отказ guard-а.
6. Одноразовые вызовы с `settingSources: []` и своим prompt-ом не получают инструкций памяти: runtime добавляет их к
   своему prompt-у только при `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` (`<claude>@301950888`). Индекс `MEMORY.md` от
   `settingSources` не зависит (`<claude>@272317507`). Но cwd этих вызовов — пустые папки данных worfy, `MEMORY.md` там нет.
7. Assistant собран. У него своя память — `<WORFY_DATA_DIR>/assistant/memory.json` с tools `memory_note` и
   `memory_forget` (`src/main/assistant/duties/memory.ts:1-6`, `src/main/mcp/app-server.ts:26-27`). С памятью Claude
   она не связана.
8. В `src/` нет UI, setting, IPC handler или MCP tool для памяти Claude. Grep по именам памяти даёт 0 совпадений
   (раздел 4.1). Домен IPC `memory` — это RAM процессов worfy (`src/shared/ipc/memory.ts:1-4`).
9. Harness читает память только через поиск qmd. Коллекция `worfy-memory` индексирует `<память>`
   (`harness/bin/qmd-collections:271`, `:277`). Правил о том, когда писать память, в Harness нет.
10. SDK даёт тип `SDKMemoryRecallMessage` (`sdk.d.ts:5307`). Но выбор памяти на каждый turn в runtime закрыт серверным
    флагом (`<claude>@263967651`). В 8 513 transcript-ах нет ни одной записи `relevant_memories`, `memory_recall` или
    `memory_saved`.

## 0. Стартовый факт

| Часть | Вердикт | Источник |
|---|---|---|
| У Product Session в system prompt есть раздел auto memory про `<память>` | Согласуется с кодом и историей. Сам prompt Product Session мне не виден | preset без замены — `options.ts:794`, `:869`; раздел есть при default prompt — `<claude>@301950888`; путь — раздел 2.3; transcript-ы — раздел 3.3 |
| В папке около 176 файлов | Уточнено: 177 файлов — `MEMORY.md` и 176 файлов тем | `find <память> -type f \| wc -l` |
| Ни у одного ключа worktree нет папки `memory` | Подтверждено: 0 из 24 ключей `.claude/worktrees/*` и 0 из 2 временных ключей их scratchpad-ов | раздел 3.1 |

Одно наблюдение из самой этой работы. Я — subagent Product Session. В мой контекст `MEMORY.md` пришёл в блоке
инструкций с меткой auto-memory. Раздела с правилами записи памяти в моём system prompt нет. Это один subagent одного
типа; для других типов не проверено.

## 1. Все вызовы `query()` и их options

### 1.1 Где и с чем

**A. Session на Node («New session», «Ship ticket»), Orchestrator, Product Session, Autopilot** — `sdkQueryFactory`
(`query.ts:400`) → `sessionOptions` (`options.ts:788-880`), вызов `query()` — `query.ts:479`.

- cwd: корень Project для новой Node (`src/main/agent/node-sessions.ts:293`); при resume — cwd по правилу Resume
  (`node-sessions.ts:500`); у Orchestrator — путь Project-а (`src/main/agent/orchestrator.ts:769`).
- settingSources: `['user', 'project', 'local']` (`options.ts:793`).
- systemPrompt: `{ type: 'preset', preset: 'claude_code' }` (`:794`). К нему `append`: инструкции canvas, Browser,
  Mind map, правила и строка Wave (`:867-869`).
- permissionMode: из настроек Session, по умолчанию `bypassPermissions` (`src/shared/agent/settings.ts:57`). Session без
  человека — всегда `bypassPermissions` (`options.ts:795`). `allowDangerouslySkipPermissions: true` (`:799`).
- plugins: копия Harness этой сборки inline, `skipMcpDiscovery: true` (`:870-871`). Путь — `sessionHarnessPlugin`
  (`:714-715`, `query.ts:467`).
- hooks: SDK-callback PreToolUse. Он сообщает папку shell, а у Product Session ещё и решает guard (`options.ts:474`,
  `:819-820`). Кроме того работают hooks Harness plugin (`harness/hooks/hooks.json`) и hooks из настроек пользователя.
- additionalDirectories: папка Cards Project-а и папка private skills; у Session без человека — только Cards
  (`options.ts:844-847`).
- env: `sessionEnv` — env агента, переменные Run, `WORFY_SESSION_KIND`, `WORFY_EPIC` (`:780-786`).
- managedSettings: MCP allowlist Profile-а (`:830`).
- Product Session отличается: `kind: 'product'` даёт guard (`query.ts:476`, `options.ts:819`),
  `WORFY_SESSION_KIND=product` (`options.ts:782`) и сервер Mind map.
- Autopilot — это Orchestrator, перезапущенный без человека (`orchestrator.ts:408`, `:546`). Epic даёт `WORFY_EPIC` и
  строку в prompt (`orchestrator.ts:767-768`, `options.ts:783`, `:868`). Run добавляет `TMPDIR` и git env
  (`src/main/agent/auto-approve/run-approval.ts:8-14`).

**B. Проверка входа при первом запуске** (accountInfo): тот же `sessionOptions`, cwd — `HOME`, сообщения нет, модель не
вызывается (`src/main/ipc/first-run.ts:84-96`).

**C. MCP inventory:** `inventoryOptions` — cwd `<WORFY_DATA_DIR>/terminal-ai`, settingSources user + project + local, без
systemPrompt, `persistSession: false`, папка Project-а как `projectConfigRoot`, сообщений нет (`options.ts:762-777`,
`query.ts:535-544`).

**D. Черновик Profile-а и Code story** (одиночный запрос `oneShot`): `draftSessionOptions` — тот же `sessionOptions`, но
`settingSources: ['user']`, preset без `append`, только read-only tools, пустой MCP allowlist, без transcript-а
(`options.ts:652-657`, `src/main/vendors/claude/one-shot.ts:58-87`). cwd — `<WORFY_DATA_DIR>/terminal-ai`
(`src/main/ipc/projects.ts:157`, `src/main/ipc/stories.ts:136`, `:293`, `src/main/projects/connect.ts:541-545`).
additionalDirectories — папка, которую читает запрос. Harness plugin — только у черновика.

**E. Narrator:** cwd `<WORFY_DATA_DIR>/narrator`, `settingSources: []`, свой systemPrompt-строка, `tools: []`,
`permissionMode: 'dontAsk'`, `maxTurns: 1`, `persistSession: false`, env без API keys
(`src/main/vendors/claude/narrator.ts:33-35`, `:53-74`, `:125-135`).

**F. Terminal AI:** запасной процесс — `settingSources: []`, свой systemPrompt, `tools: []`, `dontAsk`, `maxTurns: 1`,
`persistSession: false`, без cwd. Запрос (claim) — cwd `<WORFY_DATA_DIR>/terminal-ai` и `appendSystemPrompt` функции.
Повтор одним query — то же, prompt склеен в строку (`src/main/vendors/claude/terminal-ai.ts:37-61`, `:73-82`, `:88-98`).

**G. Limits probe:** cwd `<WORFY_DATA_DIR>/terminal-ai`, `settingSources: []`, без systemPrompt, `tools: []`, `dontAsk`,
`persistSession: false`, сообщений нет (`src/main/vendors/claude/limits.ts:110-127`, `:133-150`).

**H. Проверка источника Assistant-а (connector check):** cwd `<WORFY_DATA_DIR>/assistant-sources`, `settingSources: []`,
свой systemPrompt, только read tools одного connector-а, `dontAsk`, `persistSession: false`
(`src/main/vendors/claude/connector-check.ts:44-45`, `:155-191`, `:339-357`).

**I. Session Assistant-а:** cwd `<WORFY_DATA_DIR>/assistant/session`, `settingSources: []`, preset `claude_code` с
`append` инструкций сервера `worfy-app`, `tools: []`, один MCP-сервер `worfy-app`, `dontAsk`, `maxTurns: 40`,
`persistSession: false`, Harness plugin inline, `WORFY_SESSION_KIND=assistant`
(`src/main/vendors/claude/assistant-session.ts:37-38`, `:78-100`, `:106-130`).

### 1.2 Что из этого важно для памяти

- Папку памяти задаёт корень Project процесса Claude Code (раздел 2.3). У Session, которые видит человек, это корень
  Project. У вызовов C–I — папки данных worfy вне git.
- Раздел инструкций памяти есть только при preset (раздел 2.4). Он есть у A, B, D и I. Его нет у E, F, G и H. У C prompt
  пустой.
- `settingSources` не влияет на загрузку `MEMORY.md`. Он влияет на то, откуда runtime берёт `autoMemoryEnabled` и
  `autoMemoryDirectory` (разделы 2.3 и 2.4).

### 1.3 Env

- На Mac env берётся из login shell (`$SHELL -ilc`). Shell стартует из минимального env: системный PATH и `HOME`,
  `USER`, `LOGNAME`, `SHELL`, `TMPDIR`, `LANG`, `SSH_AUTH_SOCK`, `__CF_USER_TEXT_ENCODING`
  (`src/main/agent/env.ts:4-11`, `:35`, `:49-56`). Удаляются только `ANTHROPIC_API_KEY` и `ANTHROPIC_AUTH_TOKEN`
  (`env.ts:38`, `:77-80`).
- worfy не ставит и не удаляет для Session `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, `CLAUDE_CODE_PROJECT_DIR_NAME`,
  `CLAUDE_CONFIG_DIR` или `HOME`. Grep по `src/` находит `CLAUDE_CONFIG_DIR` только в установщике Harness и в чтении
  `.claude.json`. `HOME` и `CLAUDE_CONFIG_DIR` меняются только у команд `claude` установщика, и только в песочнице с
  `WORFY_CLAUDE_HOME` (`src/main/harness/install.ts:98-108`).
- Run Autopilot добавляет `TMPDIR` и git env, `HOME` не трогает (`run-approval.ts:8-14`).
- Диск (только наличие имён). Ни один из этих файлов не содержит `autoMemoryEnabled`, `autoMemoryDirectory`,
  `autoDreamEnabled`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_PROJECT_DIR_NAME`,
  `CLAUDE_CODE_REMOTE_MEMORY_DIR`, `CLAUDE_COWORK_MEMORY*`, `CLAUDE_MEMORY_STORES`, `CLAUDE_CODE_SIMPLE`,
  `CLAUDE_CODE_POST_TURN_MEMORY`: `~/.claude/settings.json`, `~/.zshrc`, `~/.zprofile`, `~/.bashrc`, `/etc/zshrc`,
  `/etc/zprofile`, `/etc/profile`, `/etc/bashrc`. Команда: `grep -c -E '<эти имена>' <файл>`. Файлов
  `.claude/settings*.json` в основном checkout нет. Managed settings (`/Library/Application Support/ClaudeCode/`) нет.
- В блоке `env` настроек пользователя одна переменная `CLAUDE_*`, и она не про память. Блок `hooks` пуст. Команда:
  `python3 -c 'import json;d=json.load(open("<файл>"));print(sorted(d))'` — только имена ключей.

## 2. SDK и runtime

### 2.1 Версии

| Где | SDK | Claude Code | Источник |
|---|---|---|---|
| `package.json` | 0.3.322 | — | `package.json:29` |
| lockfile | 0.3.322, пакет `darwin-arm64` 0.3.322 | — | `pnpm-lock.yaml:180`, `:224` |
| `node_modules` основного checkout | 0.3.289 (стоит с 2026-10-06, отстаёт) | 2.1.289 | `node_modules/@anthropic-ai/claude-agent-sdk/package.json`, поля `version` и `claudeCodeVersion` |
| Stable copy (бандл от 2026-11-27) | 0.3.322 | 2.1.322 | `<app.asar>@5587061` — `"claudeCodeVersion": "2.1.322"`; `<app.asar>@5547927` — `CLAUDE_AGENT_SDK_VERSION="0.3.322"`; `package.json` рядом с `<claude>` — 0.3.322; `<claude>@260409742` — `VERSION:"2.1.322"` |

- Runtime — native бинарник из платформенного пакета SDK, а не отдельная установка `claude`. В packaged app путь в
  `app.asar.unpacked` задан явно; в `pnpm dev` SDK находит бинарник сам (`options.ts:8-11`, `:132-137`).
- Версию Claude Code worfy берёт из поля `claudeCodeVersion` SDK (`src/main/vendors/claude/account.ts:19-27`).
- Дальше runtime читается по 2.1.322. Константы предела `MEMORY.md` в 2.1.289 те же: 200 и 25000.

### 2.2 Как SDK передаёт prompt и setting sources

- `systemPrompt` не задан — SDK шлёт пустой свой prompt `""`. Строка — свой prompt. `{ type: 'preset' }` — default
  prompt Claude Code плюс `append` (`<app.asar>@5547720`: `if(S===void 0)M="";else if(typeof S==="string")M=S;`).
- Prompt уходит в control request `initialize`, а не флагом командной строки.
- `settingSources` становится флагом `--setting-sources=<список>` (`<app.asar>@5472932`). Пустой список — пустой флаг.

### 2.3 Где папка памяти

Resolver runtime (`class Mc`, `<claude>@263969723`) идёт по порядку:

1. Env `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE`. Если задан, это и есть папка.
2. Setting `autoMemoryDirectory`. Источники по порядку: policy, flag settings, затем local и project — только при
   условии `NT() && !V$e()`, затем user (`<claude>@263968869`). Читаются только включённые setting sources. `~/`
   раскрывается. Корень диска, слишком короткий путь и UNC отвергаются.
3. Иначе `<база>/projects/<имя>/memory/` (`<claude>@263969723`: `path:(Ai(y,"projects",b,fy)+ko)`).
   - База — env `CLAUDE_CODE_REMOTE_MEMORY_DIR`, иначе папка конфигурации: `CLAUDE_CONFIG_DIR` или `~/.claude`
     (`<claude>@263968108`, `<claude>@260735719`).
   - Имя — env `CLAUDE_CODE_PROJECT_DIR_NAME`, только при заданном `CLAUDE_CONFIG_DIR` и только вида
     `^[A-Za-z0-9_-]{1,64}$` (`<claude>@260735926`, `<claude>@260736183`). Иначе — путь, где каждый символ кроме
     `[A-Za-z0-9]` стал `-`; длиннее 200 символов — обрезка и hash (`<claude>@261819088`, `<claude>@261819204`).
   - Путь берётся не от cwd, а от корня Project процесса через канонический git root (`defaultKey`,
     `<claude>@263970037`; `zi`, `<claude>@262004170`). У linked worktree файл `.git` начинается с `gitdir:`. Runtime
     проверяет `commondir` и обратную ссылку `gitdir` и отдаёт корень основного репозитория (`<claude>@262003405`).
     Место worktree на диске роли не играет. Вне git — сам корень Project.
- worfy кодирует ключи transcript-ов так же (`src/main/claude-home/registry.ts:50-56`). Этот способ склеивает разные
  пути: `/proj/a` и `/proj-a` дают одно имя (`registry.ts:63-64`). Для памяти это значит: два репозитория с такими
  путями делят одну папку.
- Комментарий в типах SDK 0.3.289 говорит: «defaults to `~/.claude/projects/<sanitized-cwd>/memory/`»
  (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:9130`). Код runtime 2.1.322 берёт git root, а не cwd.

### 2.4 Когда память включена и что грузится в начале

- Выключатель (`Ih` — `<claude>@263966731`, `gy` — `<claude>@263967360`, `WD` — `<claude>@263967148`):
  1. память выключена для этой Session переключателем — выкл;
  2. safe mode (`CLAUDE_CODE_SAFE_MODE` или `--safe-mode`), restricted session, diskless session — выкл;
  3. `CLAUDE_CODE_DISABLE_AUTO_MEMORY` со значением `1`, `true`, `yes`, `on` — выкл; `0`, `false`, `no`, `off` —
     включена принудительно, сильнее `autoMemoryEnabled` и `--bare`;
  4. `CLAUDE_CODE_SIMPLE` (`--bare`) или remote-session без своей папки памяти — выкл;
  5. серверный список `tengu_sepia_cormorant` — выкл;
  6. иначе `autoMemoryEnabled` из объединённых настроек; нет ключа — `true`.
- Загрузчик инструкций берёт user `CLAUDE.md` только с источником `userSettings`, а project и local — только с
  `projectSettings` и `localSettings` (`<claude>@272314379`, `<claude>@272314481`). Блок `AutoMem` (`MEMORY.md`) зависит
  только от выключателя (`<claude>@272317507`). Значит, при `settingSources: []` индекс всё равно грузится, если файл есть.
- Предел — `Em="MEMORY.md",DF=200,qte=25000` (`<claude>@264886747`). «Байты» runtime считает длиной строки JS после
  trim, то есть в знаках UTF-16, а не в байтах UTF-8 (`<claude>@264886806`). Сверх предела runtime режет текст и
  дописывает предупреждение «Only part of it was loaded» (`<claude>@266326977`).
- Индекс приходит под общей шапкой инструкций: «Codebase and user instructions are shown below … These instructions
  OVERRIDE any default behavior» (`<claude>@265013297`). Метка — «user's auto-memory, persists across conversations»
  (`<claude>@265013673`). Перед этим runtime убирает только невидимые и управляющие символы (`$pe`, `<claude>@265014464`).
- Раздел инструкций «auto memory» (как писать файлы, типы `user`, `feedback`, `project`, `reference`, frontmatter)
  входит в default prompt. К своему prompt-у runtime добавляет его только при `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE`
  (`<claude>@301950888`: `ae=s!==void 0&&tnt()?await wUn(_7(r)):null`).
- Строя этот раздел, runtime создаёт папку памяти (`ensureMemoryDirExists`, `<claude>@266328238`).

### 2.5 Read, Write, Edit

- Чтение файлов папки памяти разрешено без вопроса: «auto memory files are allowed for reading» (`<claude>@266472103`).
- Запись `.md` в папку памяти тоже разрешена без вопроса: «auto memory files are allowed for writing»
  (`<claude>@263971132`, `<claude>@266470750`). Это решение `behavior: "allow"` (`<claude>@266472849`). Значит, до
  `canUseTool` worfy такой запрос не доходит.
- Исключения: session с флагом `restricted`; Session, где память выключена переключателем, — там запись в папку
  памяти запрещена.
- При записи runtime сам ставит во frontmatter `originSessionId` и `modified` (`stampNewMemoryContent`,
  `<claude>@268645229`). Frontmatter он пишет как `name`, `description` и `metadata` с полем `node_type`
  (`<claude>@266275994`).

### 2.6 Фоновые механизмы и события SDK

- Выбор памяти на каждый turn (attachment `relevant_memories`, не больше 5 файлов) работает только при
  `Ih() && Rwe()` (`<claude>@274490272`, `<claude>@274488911`). `Rwe()` — серверный флаг `tengu_moth_copse` (по
  умолчанию выкл) или env `CLAUDE_MEMORY_STORES` (`<claude>@263967651`). В subagent-е он не работает.
- Без этого флага модель видит индекс в начале, а файлы тем читает сама, инструментом Read.
- Фоновое извлечение памяти после turn (`extract_memories`) идёт только в главном агенте (`<claude>@280346202`). Нужен
  env `CLAUDE_CODE_POST_TURN_MEMORY` или серверный флаг `tengu_passport_quail`. В неинтерактивной session — а так
  работают все Session через SDK (`<claude>@260693723`) — нужен ещё флаг `tengu_slate_thimble` (`<claude>@263967985`).
- Консолидация auto-dream: серверный флаг `tengu_onyx_plover` и setting `autoDreamEnabled` (`<claude>@280350246`).
- События и методы:
  - `SDKMemoryRecallMessage` (`system/memory_recall`) — публичный тип в объединении `SDKMessage` (`sdk.d.ts:5307`,
    `:5332`, SDK 0.3.289; схема есть и в 2.1.322 — `<claude>@263384366`). Его шлёт только выбор памяти на turn, то
    есть он под флагом выше.
  - `system/memory_saved` помечен в runtime как `@internal` (`<claude>@263330827`). В типах SDK его нет.
  - Control request `get_memory_dialog` помечен `@internal` (`<claude>@263510099`). Он отдаёт строки диалога `/memory`:
    файлы инструкций, папки памяти, до 200 записей с `type` и `modified_ms`, состояние auto memory и auto-dream. В JS
    SDK есть метод `getMemoryDialog()` (`<app.asar>@4082770`), в публичных типах его нет.
  - Setting-и в типах SDK: `autoMemoryEnabled`, `autoMemoryDirectory`, `autoDreamEnabled` (`sdk.d.ts:9126`, `:9130`,
    `:9134`).
- Типы смотрелись по SDK 0.3.289 из `node_modules` основного checkout. Файла `.d.ts` версии 0.3.322 в `<app.asar>` я не
  нашёл; JS 0.3.322 проверен там.

## 3. Диск

### 3.1 Ключи под `~/.claude/projects`

Команды: `ls ~/.claude/projects | wc -l`; `for d in ~/.claude/projects/*/; do [ -d "$d/memory" ] && echo "$d"; done | wc -l`;
ключи worfy — `ls ~/.claude/projects | grep -E -i 'CanvasForAI|worfy'`.

- Всего 130 ключей. Папка `memory` есть у 53 — это все проекты этого Mac.
- Ключей, связанных с worfy, 50. Папка `memory` есть у 14. Не пустая — только одна.

| Группа | Ключей | С папкой `memory` | Не пустых |
|---|---|---|---|
| основной checkout | 1 | 1 | 1 (177 файлов) |
| `<основной checkout>/.claude/worktrees/*` | 24 | 0 | 0 |
| scratchpad-ы session из worktree во временной папке системы | 2 | 0 | 0 |
| папка данных worfy: `assistant/session` и `terminal-ai` | 2 | 2 | 0 |
| папка данных worfy: временные папки Run Autopilot (`autopilot-tmp/*`) | 11 | 1 | 0 |
| временная папка системы: test-ы и проверки Harness | 7 | 7 | 0 |
| три папки для работы над worfy вне репозитория: песочница, демо-проект, папка запуска скриптов Orchestrator-а | 3 | 3 | 0 |

- Пустые папки — след того, что runtime создаёт папку памяти, когда строит раздел инструкций (раздел 2.4).
- Папка у ключа `assistant/session` появилась 2026-11-26 в 18:29 UTC. Это после сдачи ticket 10 Epic-а worfy-assistant
  (Session Assistant-а, сдан 2026-11-26 в 03:26 UTC, `.scratch/worfy-assistant/issues/10-session-assistant-а.md:4`).
- Папка у ключа `terminal-ai` появилась 2026-11-17 в 00:26 UTC. В этой папке preset получают черновик Profile-а и Code
  story (раздел 1.1, D).
- Команда: `stat -f '%SB' <ключ>/memory`. Какой процесс создал каждую папку — не проверено.

### 3.2 Папка `<память>`

Снимок 2026-11-28, 03:19 UTC. Папка меняется прямо во время работы: один файл тем обновился в 03:17 UTC.

- 177 файлов, все `.md`, подпапок нет (`find <память> -type f | wc -l`).
- Самый старый mtime — 2026-10-06, 00:32 UTC. Самый новый — 2026-11-28, 03:17 UTC (`stat -f '%Sm' <память>*.md | sort`).
- `MEMORY.md`: 107 строк, 15 828 байт (`wc -l -c`), 15 369 знаков UTF-16 после trim. Предел — 200 строк и 25 000 знаков.
  Сейчас индекс грузится целиком.
- В индексе 107 ссылок на 107 разных файлов. Ещё 69 файлов тем индекс не называет. На них ссылается один файл тем —
  второй уровень индекса. Недостижимых файлов нет. Метод: ссылки вида `](<файл>.md)`.
- Файлы тем — от 782 до 31 474 байт, вместе около 726 KB.
- Поля frontmatter. Команда:
  `awk 'FNR==1{f=0} /^---$/{f++; next} f==1 && /^ *[A-Za-z_]+:/{k=$0; sub(/:.*/,"",k); print k}' <память>*.md | sort | uniq -c`.
  - Верхний уровень: `name`, `description`, `metadata` — у всех 176 файлов тем.
  - Внутри `metadata`: `type` — 176, `modified` — 147, `node_type` — 145, `originSessionId` — 145.
  - Значения `type`: `project` — 139, `feedback` — 31, `reference` — 6, `user` — 0.
- Кто писал. Метод: `originSessionId` файла → transcript этой Session → поле `entrypoint` transcript-а.
  - 94 файла — от 12 Session через Agent SDK (`entrypoint` `sdk-ts`) в ключе основного checkout. worfy — клиент
    TypeScript SDK, так что это, вероятно, Session worfy. Одно поле этого не доказывает.
  - 51 файл — от 10 session приложения Claude desktop (`claude-desktop`) в ключах `.claude/worktrees/*`.
  - 31 файл без `originSessionId`. Автор не установлен.

### 3.3 Индекс в начале Session: история

Метод: transcript-ы старше 6 часов (более свежие могли быть от этой работы). В них найдены attachment-ы
`"type":"instructions"`, в их `files[]` проверены `type` (`AutoMem`) и `path`. Содержимое не читалось. Скрипт был
временным. В настройках пользователя задан `cleanupPeriodDays`, так что старые transcript-ы могли быть удалены: числа —
нижняя граница.

| Ключи | Клиент | Transcript-ов Session | Из них с `AutoMem` → `<память>MEMORY.md` |
|---|---|---|---|
| основной checkout | `sdk-ts` | 33 | 33 |
| основной checkout | `cli` | 2 | 2 |
| основной checkout | `claude-desktop` | 3 | 0 |
| `.claude/worktrees/*` | `sdk-ts` | 10 | 10 |
| `.claude/worktrees/*` | `claude-desktop` | 42 | 36 |
| `.claude/worktrees/*` | `cli` | 1 | 1 |
| прочие ключи worfy | `sdk-ts`, `sdk-cli` | 24 | 0 |

- Subagent-ы тоже получают индекс. В ключе основного checkout `AutoMem` → `<память>MEMORY.md` несут 2 950 transcript-ов
  subagent-ов из 3 025, в ключах worktree — 4 727 из 5 358.
- `AutoMem` ни разу не указывал на другую папку.
- Предупреждение об обрезке индекса («Only part of it was loaded») есть в 19 transcript-ах. Все — с 2026-11-23 23:01 до
  2026-11-24 02:55 UTC, размер индекса около 24.5 KB. 18 из них — subagent-ы в ключе основного checkout.
- Записей `"type":"relevant_memories"`, `"subtype":"memory_recall"`, `"subtype":"memory_saved"` и
  `"querySource":"extract_memories"` — 0 в 8 513 transcript-ах. Attachment-ы в transcript-ы пишутся: в ключе основного
  checkout их десятки типов и тысячи строк. Значит, выбор памяти на turn и фоновое извлечение здесь не работали.
- Вызовы инструментов с путём внутри `<память>`:
  - Session через SDK в основном checkout: Write — 103, Edit — 32, Read — 6. Их subagent-ы: Read — 5, Write — 2.
  - Session Claude desktop в worktree: Edit — 237, Write — 139, Read — 45. Их subagent-ы: Read — 9, Write — 2.
  - Ответов guard-а Product Session «never written by a Product Session» с путём `/memory/` — 1.
- Это счёт по файлам этого Mac. Это не аналитика того, как часто кто-то пользуется памятью.

### 3.4 Worktree Ticket-ов

- Profile worfy на этом Mac, поле `worktree`: `root` — `<основной checkout>/.claude/worktrees`; implementer —
  `git worktree add -b <branch> <root>/<NN> origin/main`; reviewer — `git worktree add <root>/review-<review-target> --detach <branch>`.
  Файл — `~/.claude/worfy-harness/projects/worfy/profile.json`, команда —
  `python3 -c 'import json;print(json.load(open("<файл>"))["worktree"])'`.
- Harness: подключённые Project-ы держат worktree в `.claude/worktrees/` внутри репозитория;
  `<HARNESS_HOME>/worktrees/<name>/` пока только план (`harness/profiles/README.md:174`, `:176`). Implementer сам создаёт
  worktree и входит в него через `EnterWorktree` (`harness/agents/implementer.md:47-55`).
- Это linked worktree одного репозитория. Runtime отдаёт им папку памяти основного checkout (раздел 2.3).
- История это подтверждает. У 24 ключей worktree нет своей папки. Их Session грузили `<память>MEMORY.md` и писали в
  `<память>` (разделы 3.2 и 3.3).
- Итог: Session в worktree **делят** память основного checkout. Своей у них нет.

### 3.5 Linked Machine и Codex

- Session, Terminal, Gate и Autopilot Project-а идут на его Machine. Linked machine только видит или управляет
  (`CONTEXT.md:386-387`, `:478`).
- В `src/main/link` нет кода про память Claude. Grep `memory|MEMORY\.md|claude/projects` находит там только «in memory»
  в смысле RAM.
- Значит, у каждой Machine своя `~/.claude/projects/<ключ>/memory/`. Между Machine она не синхронизируется. Диск второй
  Machine я не проверял.
- Codex коротко. Протокол установленного app server знает `ThreadMemoryMode` (`enabled` или `disabled`),
  `MemoryCitation` и источник `memory_consolidation` (`src/main/vendors/codex/protocol/ts/ThreadMemoryMode.ts:5`,
  `src/main/vendors/codex/protocol/ts/v2/MemoryCitation.ts:6`, `src/main/vendors/codex/protocol/ts/InternalSessionSource.ts:5`).
  Driver worfy их не задаёт: вне `protocol/` 0 совпадений. Папок `~/.codex/memories` и `~/.codex/memory` нет. В
  `~/.codex/config.toml` нет строк про память. Поведение Codex по умолчанию не проверено.

## 4. Что worfy уже делает с памятью

### 4.1 Код worfy

- Для памяти Claude нет UI, setting, IPC handler или MCP tool. Grep по `src/` и `test/` на
  `autoMemory|autoDream|MEMORY\.md|DISABLE_AUTO_MEMORY|PROJECT_DIR_NAME|memory_recall|memory_saved|relevant_memories|getMemoryDialog|get_memory_dialog|agent-memory`
  даёт 0 совпадений.
- Домен IPC `memory` и setting «Memory in the version popover» — это RAM процессов worfy (`src/shared/ipc/memory.ts:1-4`,
  `src/main/diagnostics/memory.ts:1-5`, `src/renderer/settings/GeneralSection.tsx:97-105`). Feature page это оговаривает
  (`docs/features/transcripts-and-usage.md:4`).
- Guard Product Session. Write, Edit, MultiEdit и NotebookEdit работают только в папке Product Session. Claude home и
  папка данных worfy закрыты даже с разрешения человека (`src/main/agent/product-guard.ts:7-21`, `:211-212`; список
  закрытых папок — `src/main/vendors/claude/query.ts:297-305`).
- Bash этот guard не закрывает. Он отказывает только известным командам, которые пишут в репозиторий
  (`product-guard.ts:22-28`).
- Autopilot. Session без человека идёт в `bypassPermissions`. Запрос разрешения, если он всё же приходит, решает
  политика Run-а или отказ (`src/main/agent/session.ts:70-74`). Политика считает `~/.claude` закрытой зоной и для чтения,
  и для записи (`src/main/agent/auto-approve/roots.ts:8-10`, `:185-186`, `:200`). Но runtime пускает запись памяти без
  запроса (раздел 2.5), так что политика её не видит. Это вывод из чтения; в работе не проверено.
- Свой reader `~/.claude` у worfy только читает (`src/main/storage/paths.ts:47-51`). Ключи он кодирует как runtime
  (`src/main/claude-home/registry.ts:50-56`).

### 4.2 Harness

- PreToolUse hook Harness ловит только `Bash|apply_patch` (`harness/hooks/hooks.json:185-187`). Write и Edit памяти он
  не видит.
- Ни один subagent Harness не задаёт поле `memory:` — память subagent-а в Claude Code. Во frontmatter
  `harness/agents/*.md` только `name`, `description`, `tools`, `model`, `effort` и у implementer — `experimental`.
- Правил «когда писать память» в Harness нет. Grep по `harness/` находит память только как место поиска:
  `harness/skills/qmd/SKILL.md:77`, `:116`, `:153`; `harness/agents/reviewer.md:47`; `harness/hooks/rules/orchestrator.md:48`;
  `harness/skills/ship-ticket/SKILL.md:123`; `harness/profiles/README.md:220`.
- `harness/bin/start-context` считает в контексте старта первые 200 строк `MEMORY.md` основного checkout и пишет, что
  worktree делит auto memory основного checkout (`:31-32`, `:108`, `:197`, `:218-225`). Предел 25 000 знаков он не
  учитывает.
- Правила Assistant-а про его собственную память — tools `memory_note` и `memory_forget`
  (`harness/hooks/rules/assistant.md:26`, `:63-70`).

### 4.3 qmd

- `harness/bin/qmd-collections` заводит коллекцию `<project>-memory`: путь
  `<CLAUDE_CONFIG_DIR или ~/.claude>/projects/<путь Project-а через "-">/memory`, шаблон `**/*.md`, без `update:`
  (`:8-10`, `:271`, `:277`, `:321`).
- `qmd-refresh` на Stop hook обновляет такие коллекции, когда есть файл новее индекса (`harness/bin/qmd-refresh:15-16`,
  `:203`; `harness/hooks/hooks.json:134`, `:157`).
- Profile worfy называет `worfy-docs`, `worfy-tickets` и `worfy-memory` (поле `qmd.collections` в `profile.json`).
- `worfy-memory` — это `<память>`, шаблон `**/*.md`. В индексе 177 документов, последнее обновление — 2026-11-28
  02:55:42 UTC, время самого нового файла на тот момент. Источник — MCP tool `status` сервера qmd.
- Коллекция `memory` — папка памяти другого зарегистрированного проекта, не worfy. Источник — `~/.config/qmd/index.yml`.

### 4.4 Память Assistant-а

- Спроектирована: «Память — файл состояния» (`.scratch/worfy-assistant/spec.md:69`, `:96`, `:305`). ADR-0114 — решение о
  Session приложения для Assistant-а (`docs/adr/0114-assistant-app-session.md:42`, `:179`).
- Собрана. Ticket 07 (обязанности Assistant-а) сдан 2026-11-25, ticket 10 (Session Assistant-а) — 2026-11-26
  (`.scratch/worfy-assistant/issues/07-обязанности.md:4`, `.scratch/worfy-assistant/issues/10-session-assistant-а.md:4`).
- Файл — `<WORFY_DATA_DIR>/assistant/memory.json`, пишет его только main (`src/main/assistant/duties/memory.ts:1-11`).
- Session пишет в него через tools `memory_note` и `memory_forget` сервера `worfy-app` (`src/main/mcp/app-server.ts:26-27`,
  `:688`, `:699`; `src/shared/assistant/memory.ts:1-6`). Новая Session получает файл в первом сообщении
  (`src/main/assistant/session/memory.ts:1-12`).
- UI: Settings → Assistant → Memory — правила из dislike, у каждого Delete
  (`src/renderer/settings/AssistantSection.tsx:12`, `:404-419`; `docs/features/assistant.md:280`).
- На диске файл есть: 16 882 байта, ключи верхнего уровня `duties`, `items`, `proposals`, `rules`
  (`~/Library/Application Support/worfy/assistant/memory.json`, только имена ключей).
- С памятью Claude он не связан. У Session Assistant-а `tools: []`, файл памяти Claude она записать не может
  (`assistant-session.ts:89`).

## 5. ADR и feature pages

Ни один ADR и ни одна feature page не говорят об auto memory Claude Code: grep `auto.?memory|MEMORY\.md` по
`docs/adr` и `docs/features` — 0 файлов. Ближайшее по теме.

ADR:

- `docs/adr/0002-worfy-is-a-view-over-the-workflow.md:5` — источник правды остаётся там, где он есть без worfy, включая
  hooks из `~/.claude`; `:10` — агенты с изолированной конфигурацией отвергнуты.
- `docs/adr/0005-worfy-own-state-inventory.md:95`, `:118-120` — `assistant/memory.json` лежит в папке данных worfy.
- `docs/adr/0019-harness-claude-code-plugin.md:27-28` — личные skills, MCP-серверы и память пользователя в Harness не
  входят и не трогаются; `:35` — Session с `settingSources: user + project + local` остаётся.
- `docs/adr/0021-mcp-servers-allowlist-in-profile.md:24` — `CLAUDE.md`, hooks, skills и Subagent-ы по-прежнему из
  конфигурации пользователя.
- `docs/adr/0040-harness-delivery-local-marketplace.md:27` — Session SDK с `'user'` в `settingSources` грузит plugin-ы
  из области пользователя.
- `docs/adr/0041-harness-rules-via-session-hooks.md:11`, `:69` — plugin не несёт `CLAUDE.md`, правила идут через hooks;
  `CLAUDE.md` в корне plugin Claude Code не грузит.
- `docs/adr/0043-qmd-is-part-of-harness.md:4`, `:47-48` — qmd ищет и по памяти Claude; коллекции Profile-а включают
  память Claude по Project-у.
- `docs/adr/0047-harness-lessons-by-pr-early-owner-switch.md:62-64` — при переходе Harness на plugin память и
  transcript-ы остаются на месте.
- `docs/adr/0048-harness-plugin-spike-results.md:25`, `:34` — spike шёл с `settingSources` как у worfy; plugin из
  области пользователя грузится с `user`.
- `docs/adr/0049-worfy-sessions-without-inline-plugin-on-legacy-harness.md:15` — Session грузит настройки пользователя.
- `docs/adr/0058-terminal-ai-assist-process.md:24`, `:72-73`, `:80` — процесс Terminal AI с `settingSources: []`: без
  настроек, hooks, plugin-ов и `CLAUDE.md`; hooks встроенных plugin-ов это не убирает.
- `docs/adr/0084-session-skills-and-plugins-by-profile-list.md:30`, `:50` — `settingSources` не меняются; вариант без
  `user` отвергнут, потому что пропали бы `CLAUDE.md` и hooks пользователя.
- `docs/adr/0114-assistant-app-session.md:42`, `:44`, `:179` — новая Session на каждое пробуждение, память — файл
  состояния; cwd вне Project-ов, `CLAUDE.md` и hooks Project-ов не грузятся.

Feature pages:

- `docs/features/sessions.md:385` — Session идёт с настройками, `CLAUDE.md` и hooks пользователя.
- `docs/features/transcripts-and-usage.md:4` — «Memory» — это память процессов worfy, а не память Claude.
- `docs/features/assistant.md:280`, `:299`, `:413-414`, `:543` — вкладка Memory Assistant-а, файл `assistant/memory.json`,
  Session Assistant-а без `CLAUDE.md` и без настроек.
- `docs/features/skills-agents-and-hooks.md:351` — правила Harness — не `CLAUDE.md`; из корня plugin он не грузится.
- `docs/features/harness.md:384` — `qmd-collections` заводит три коллекции Project-а.
- `docs/features/projects.md:91-92` — при переезде между режимами `<name>-memory` сохраняет путь.

## 6. Итог по spike

Пункты spike — `docs/claude-projects-parity-proposal.md` в PR #2270, строки 58–66.

### 6.1 Отвечено чтением

| Пункт spike | Ответ | Где |
|---|---|---|
| Конфигурация `query()`, версии SDK и runtime, cwd, env, systemPrompt, settingSources, permissions, hooks, Harness | Да | разделы 1, 2.1, 2.2 |
| Активна ли память сейчас | Да: в Session, Orchestrator, Product Session и Autopilot; 33 из 33 transcript-ов | разделы 1.2, 3.3 |
| Активна ли при `settingSources: []` и своём prompt-е | По коду: индекс грузится, инструкций нет; у вызовов worfy `MEMORY.md` в их папках нет | разделы 1.2, 2.4 |
| Есть ли и что значат `autoMemoryEnabled`, `autoMemoryDirectory`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, `CLAUDE_CODE_PROJECT_DIR_NAME` | Да, по runtime 2.1.322; уверенность средняя-высокая | разделы 2.3, 2.4 |
| Read, Write, Edit и путь | Runtime пускает без вопроса; worfy закрывает только Write/Edit Product Session; путь — канонический git root | разделы 2.3, 2.5, 4.1 |
| Есть ли у SDK события памяти | Тип `memory_recall` есть, но под серверным флагом; `memory_saved` и `getMemoryDialog` внутренние | раздел 2.6 |
| Test 3, часть: тот же репозиторий, worktree, обычные subagent-ы | Делят папку основного checkout; subagent получает индекс | разделы 3.3, 3.4 |
| Test 3, часть: несвязанные Project-ы, Linked Machine | Разные папки по ключу, но пути, которые отличаются только не-буквенными символами, склеиваются; у каждой Machine своя память | разделы 2.3, 3.5 |
| Test 6, часть: рост хранилища | 177 файлов и около 0.74 MB с 2026-10-06; индекс уже один раз выходил за предел | разделы 3.2, 3.3 |

### 6.2 Нужен эксперимент

Все эксперименты — в песочнице: свой `CLAUDE_CONFIG_DIR` и свой репозиторий, чтобы не трогать настоящую `<память>`.

| Пункт | Что неизвестно | Самый дешёвый эксперимент |
|---|---|---|
| Test 1: научить и вспомнить | Вспомнит ли новая Session без подсказки | Попросить Session запомнить уникальное безобидное предпочтение, затем в новой Session дать задачу, где оно меняет ответ, не называя его. |
| Test 2: вкл и выкл, preset и свой prompt, явный отказ | Подтвердить семантику из раздела 2.4 в работе | Четыре коротких query в песочнице (env `1`; env `0` вместе с `autoMemoryEnabled: false`; `autoMemoryDirectory` во flag settings; `settingSources: []` со строковым prompt-ом), после каждого смотреть, где появилась папка `memory` и есть ли `AutoMem` в transcript-е. |
| Setting `autoMemoryDirectory` из project и local в SDK-session | Что значит условие `NT() && !V$e()` для worfy | Тот же query с ключом в `.claude/settings.local.json` песочницы, затем проверить, где появилась папка. |
| Test 3: Project над несколькими репозиториями | Какой ключ получит Session Project-а в режиме Silent | Открыть Session в таком Project-е и прочитать путь `AutoMem` в её transcript-е. |
| Test 3: fork-subagent | Получает ли он индекс и инструкции родителя | Запустить fork в Session песочницы и прочитать attachment `instructions` в его transcript-е. |
| Test 3: Linked Machine | Что лежит на второй Machine | На PC выполнить `ls ~/.claude/projects/*/memory` и сравнить ключи. |
| Test 4: параллельные записи, конфликты, сбои | Теряются ли записи; блокировки в runtime я не нашёл, но и не искал до конца | Две Session одного репозитория одновременно сохраняют по одной записи; проверить оба файла и обе строки в `MEMORY.md`. |
| Test 5: права и вредные инструкции | Перевешивает ли индекс правила Harness и Profile: runtime подаёт его как инструкции с «OVERRIDE any default behavior» | Положить в `MEMORY.md` песочницы безобидную строку против правила Harness и посмотреть, какому из двух следует Session. |
| Test 5: обход guard-а Product Session | Запишет ли Product Session память через Bash | Попросить Product Session песочницы сохранить память и проверить, появился ли файл. |
| Autopilot | Видит ли политика Run-а запись памяти | Одна Wave Autopilot в песочнице с Auto-approval On и просьбой сохранить память; затем journal решений политики и папка памяти. |
| События SDK | Включён ли серверный флаг выбора памяти для этого аккаунта | Записать все `system/*` сообщения одной Session, где вопрос касается темы из памяти, и искать `memory_recall`. |
| Test 6: качество, ложные воспоминания, токены, задержка | Всё | Самое дешёвое — счёт токенов блока `AutoMem` по уже лежащим transcript-ам; полный ответ даст только eval на фиксированных задачах с памятью и без. |

## Не проверено

- System prompt Product Session мне не виден. Вывод о разделе auto memory — из кода и transcript-ов.
- Состояние серверных флагов для этого аккаунта: `tengu_moth_copse`, `tengu_passport_quail`, `tengu_slate_thimble`,
  `tengu_onyx_plover`, `tengu_sepia_cormorant`. По transcript-ам первые три не срабатывали.
- Цепочки вызовов в минифицированном runtime читались по ближайшему определению имени. Имена повторяются в других
  модулях. Константы и строки найдены точно.
- Типы SDK 0.3.322: файла `.d.ts` в Stable copy нет. Типы читались по 0.3.289.
- Что значат `NT()` и `V$e()` для `autoMemoryDirectory` из project и local в SDK-session.
- Какой процесс создал каждую пустую папку памяти. Вывод про `terminal-ai` и `assistant/session` — по датам и коду.
- Что 12 Session с `entrypoint` `sdk-ts` — именно Session worfy.
- Автор 31 файла без `originSessionId`.
- Бывают ли у worfy session с флагом `restricted`.
- Поведение fork-subagent-а.
- Project над несколькими репозиториями: на этом Mac такой не измерялся.
- Диск второй Machine.
- Есть ли в runtime блокировка при записи памяти.
- Обходит ли запись памяти политику Autopilot на деле.
- Поведение памяти Codex по умолчанию.
- Раздел инструкций памяти у subagent-ов других типов: проверен один, мой.
