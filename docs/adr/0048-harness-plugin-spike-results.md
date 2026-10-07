# 0048 — Итоги spike plugin-а Harness: hooks у Subagent-ов workflow-скриптов, `GH_TOKEN` через `CLAUDE_ENV_FILE`, установка plugin-а, сервер qmd под именем `plugin_worfy_qmd`
Дата: 2026-10-07. Статус: принят.

**Контекст.** Harness становится plugin-ом `worfy` (ADR-0040). Ticket-ы Epic-а `worfy-harness`
стоят на четырёх непроверенных вопросах (spec.md, «Риски», пункт 1):

1. доходят ли hooks plugin-а до Subagent-ов workflow-скриптов (инструмент `Workflow`, ADR-0035);
2. работает ли `GH_TOKEN` аккаунта Project-а через `CLAUDE_ENV_FILE` (Q21);
3. как встроенный бинарь SDK ставит plugin из локального marketplace (Q1, Q8, Q12);
4. каким именем MCP-сервер plugin-а проходит список MCP-серверов Project-а (Q15, ADR-0021, ADR-0043).

Ответы сняты Ticket-ом `worfy-harness/01` 2026-10-07 скриптом
`scripts/spikes/harness-plugin/probe.ts`: plugin-образец `fixture/` с именем `worfy` (hooks
`SessionStart`, `SubagentStart`, `PreToolUse`; команда `bin/worfy-spike-bin`; skill; `.mcp.json` с
сервером `qmd`) и marketplace `marketplace/`. Каждый сценарий запускается одной командой
`pnpm exec electron scripts/spikes/harness-plugin/probe.ts <сценарий>`. Версии:

- `@anthropic-ai/claude-agent-sdk` 0.3.289, встроенный в него Claude Code 2.1.289
  (`@anthropic-ai/claude-agent-sdk-darwin-arm64`);
- `claude --version` в терминале — 2.1.291 (Claude Code);
- Electron 44.5.1, macOS arm64; модель — haiku, у сценария `env-file` — sonnet (haiku отказался
  считать хеш `GH_TOKEN`).

Сценарии `known`, `workflow-hooks` и `env-file` шли на настоящих настройках пользователя
(`settingSources: ['user', 'project', 'local']`, как у worfy) во временной рабочей папке. Сценарии
`install` и `mcp-name` и часть `known` шли в песочнице: `HOME` и `CLAUDE_CONFIG_DIR` во временной
папке, без входа в Claude. `system/init` и MCP-серверы Claude Code отдаёт и без входа. Хеши
`~/.claude/settings.json`, `~/.claude/plugins/installed_plugins.json` и
`~/.claude/plugins/known_marketplaces.json` до и после каждого сценария совпали.

Пять фактов прошлого spike 2026-10-07 (ADR-0040, «Spike 2026-10-07») сценарий `known` повторил из
репозитория, все пять — да:

- plugin, поставленный в область пользователя, грузится Session-ом с `settingSources` `user`;
- `plugins: [{type: 'local', path}]` с тем же именем заменяет его: в `system/init` один `worfy`,
  `source: worfy@inline`, версия inline, путь inline;
- `bin/` plugin-а лежит в PATH у Bash главной Session и Subagent-а;
- `${CLAUDE_PLUGIN_ROOT}` в тексте SKILL.md заменён путём plugin-а;
- `additionalContext` hook-а `SessionStart` виден главной Session, `SubagentStart` — Subagent-у.
  Метка `SessionStart` до Subagent-а не доходит.

**Решение.**

1. **Hooks у Subagent-ов workflow-скриптов — да, основной путь ADR-0041 в силе.** Главная Session
   вызвала `Workflow` со скриптом из одного `agent()`. Hook `SubagentStart` plugin-а сработал с
   `agent_type: workflow-subagent` и `agent_id` во входе. Агент увидел метку `SubagentStart` и не
   увидел метку `SessionStart`, как обычный Subagent. Команда из `bin/` нашлась в его PATH. Hook
   `PreToolUse` plugin-а тоже срабатывает у такого агента, с тем же `agent_type`. Запасной путь не
   нужен: правила Subagent-а workflow-скрипта приходят через `SubagentStart`, как у любого
   Subagent-а. По `agent_type` hook может отличить агента workflow-скрипта (`workflow-subagent`) от
   Subagent-а инструмента `Agent` (`general-purpose`, `worfy:implementer`…).
2. **`GH_TOKEN` через `CLAUDE_ENV_FILE` — да, основной путь Q21 в силе.**
   - `CLAUDE_ENV_FILE` задан hook-у `SessionStart` plugin-а и у встроенного бинаря SDK (2.1.289),
     и у `claude -p … --plugin-dir` в терминале (2.1.291).
   - Hook дописал в файл строку `export GH_TOKEN="$(gh auth token -u <account>)"` буквально.
     Claude Code исполняет файл перед каждой командой Bash: 5 команд Bash (3 в главной Session, 1
     у Subagent-а `general-purpose`, 1 у агента workflow-скрипта) — 5 вызовов
     `gh auth token -u <account>`; в терминале 1 команда — 1 вызов. Токен вычисляется на каждой
     команде и на диске не лежит.
   - `GH_TOKEN` видят Bash главной Session, Subagent-а и агента workflow-скрипта: sha256 значения у
     каждого совпал с sha256 фальшивого токена подменённого `gh`.
   - Фальшивого токена нет ни в выводе spike-а, ни в выводе hook-ов, ни в транскриптах его
     Session-ов (`grep -rlF` — exit 1).
   - С настоящим `gh` и аккаунтом Project-а worfy (`IDSAD-XL`; глобальный аккаунт `gh` другой):
     `gh api user --jq .login` в Bash Session ответил `IDSAD-XL`, sha256 `GH_TOKEN` совпал с
     sha256 `gh auth token -u IDSAD-XL`. Значение сравнивалось только в памяти; в транскриптах и в
     выводе spike-а его нет (0 файлов).
   Ticket 18 идёт по основному пути: строку пишет hook `SessionStart` Harness-а, ручной префикс
   `GH_TOKEN=$(…)` из skills и agents уходит. Запасной путь (worfy кладёт `GH_TOKEN` в env своих
   Session-ов) не нужен, и в терминале ручной `export` тоже не нужен.
3. **Установка из локального marketplace — работает без сети и без входа.** Каждая команда
   встроенного бинаря шла дважды:
   - `plugin validate <plugin>` и `plugin validate <marketplace>` — exit 0 оба раза
     («Validation passed with warnings»: нет `author`);
   - `plugin marketplace add <папка>` — exit 0; повтор — exit 0 («already on disk»). Пишет
     `extraKnownMarketplaces.<имя>` (`source: directory`) в `settings.json` и запись в
     `plugins/known_marketplaces.json`;
   - `plugin install worfy@<marketplace> --scope user --json` — exit 0, `"outcome":"ok"`; повтор —
     exit 0, `"outcome":"ok"`, «already installed … loads in place», с `installedVersion` и
     `availableVersion`;
   - plugin грузится на месте: `plugin list --json` даёт `readFromFolder` — папку plugin-а в
     marketplace, и Session в `system/init` берёт plugin оттуда. Но копию Claude Code всё равно
     кладёт в `plugins/cache/<marketplace>/worfy/<version>/` и пишет этот путь в
     `installed_plugins.json` (`installPath`);
   - смена `version` в папке: `plugin list` показывает новую `folderVersion` при старой `version`.
     Новую версию записывает `plugin update worfy@<marketplace> --scope user` — exit 0, «updated
     from 0.1.0 to 0.2.0 … Restart to apply changes»; повтор — exit 0, «already at the latest
     version». Повторный `plugin install` версию **не** обновляет (exit 0, совет вызвать
     `update`). `plugin marketplace update` для этого не нужен;
   - версия вида `<semver>+<SHA>` (ADR-0040, пункт 4) работает: `update` записывает и смену
     одного SHA при той же semver (`0.4.0+aaaaaaa` → `0.4.0+bbbbbbb` и обратно), и меньшую версию
     (`0.4.0+aaaaaaa` → `0.3.9+ccccccc`). Каталог копии — `0.4.0-aaaaaaa` (`+` заменён на `-`);
   - `plugin uninstall worfy@<marketplace> --scope user` — exit 0; повтор — exit 1 («not found in
     installed plugins»). После него `enabledPlugins` пуст, marketplace остаётся в
     `extraKnownMarketplaces`, копии в `plugins/cache` остаются с файлом `.orphaned_at`;
   - одна папка — и marketplace, и plugin (`.claude-plugin/plugin.json` и
     `.claude-plugin/marketplace.json` рядом, `source: "./"`): `validate`, `marketplace add`,
     `install` — exit 0, plugin грузится из этой папки. Так копия `harness/` сама может быть
     marketplace-ом (ADR-0040, пункт 1);
   - ни одна команда не потребовала входа (песочница без входа), и все прошли с `HTTPS_PROXY` и
     `HTTP_PROXY` на закрытый локальный порт.
   Ticket 13 ставит Harness командами `marketplace add`, `install --scope user` и, при смене
   версии, `update --scope user`; повторный `install` версию не меняет.
4. **MCP-сервер qmd в Session-ах worfy — сервер worfy под именем `plugin_worfy_qmd`.**
   - Сервер из `.mcp.json` plugin-а называется `plugin:worfy:qmd` (`source: plugin`), его
     инструменты — `mcp__plugin_worfy_qmd__<tool>`.
   - При `allowManagedMcpServersOnly: true` **ни одна запись `serverName`** его не пропускает:
     `qmd`, `plugin:worfy:qmd`, `plugin_worfy_qmd`, `worfy:qmd`, `worfy` — сервера нет. Пропускает
     только `serverCommand` с уже подставленным путём (`['node', '<plugin>/mcp/server.mjs']`);
     `${CLAUDE_PLUGIN_ROOT}` в записи не подставляется.
   - Если в списке есть хоть одна запись `serverCommand`, stdio-серверы, названные только по
     имени, больше не проходят: `[{serverName:'qmd'}, {serverCommand:[…plugin…]}]` пропускает
     сервер plugin-а и теряет `qmd` пользователя.
   - Когда у пользователя свой `qmd` в `~/.claude.json` (так у владельца), без списка видны оба:
     `qmd` (`source: user`, `mcp__qmd__…`) и `plugin:worfy:qmd`. Запись `qmd` пропускает только
     сервер пользователя. Одной записи на оба нет.
   - `skipMcpDiscovery: true` у plugin-а inline убирает его собственный сервер: без списка
     (`allowedMcpServers` не задан) сервера `plugin:worfy:qmd` нет, и со списком
     `[{serverCommand: ['node', '<plugin>/mcp/server.mjs']}]`, который без `skipMcpDiscovery` его
     пропускает, — тоже нет. `qmd` пользователя без списка при этом подключён.
   - Stdio-сервер, который worfy сам регистрирует в `mcpServers` под именем `plugin_worfy_qmd`
     (`source: dynamic`), список фильтрует по имени, как сервер пользователя. Три варианта, у
     всех `skipMcpDiscovery: true` и `qmd` пользователя в `~/.claude.json`:
     - `[{serverName:'plugin_worfy_qmd'}, {serverName:'qmd'}, {serverName:'worfy-canvas'}]` —
       подключены `plugin_worfy_qmd` и `qmd`; инструменты `mcp__plugin_worfy_qmd__plugin_ping`
       (те же имена, что у сервера plugin-а в терминале) и `mcp__qmd__user_ping`;
     - `[{serverName:'qmd'}, {serverName:'worfy-canvas'}]` — `plugin_worfy_qmd` нет, `qmd` есть;
     - `[]` — нет ни того, ни другого.
     То же без `qmd` пользователя: со своим именем в списке сервер есть, без имени и при пустом
     списке — нет. Фильтр по имени для такого сервера работает. Мимо списка проходит только
     SDK-сервер в процессе (ниже).

   Выбрано (решено без владельца, подтвердить): Session-ы worfy получают plugin inline с
   `skipMcpDiscovery: true`, а серверы из его `.mcp.json` worfy регистрирует сам в `mcpServers`
   под именами `plugin_worfy_<сервер>`, с `${CLAUDE_PLUGIN_ROOT}`, заменённым на путь inline.
   Поле Profile `mcp.allowed` пишет для qmd из plugin-а строку `plugin_worfy_qmd`.
   `DEFAULT_MCP_SERVERS` меняется на `['plugin_worfy_qmd', 'worfy-canvas']`. Строка `qmd` в
   `mcp.allowed` по-прежнему означает сервер `qmd` пользователя из `~/.claude.json`; по умолчанию
   его нет, и в Session worfy не бывает двух qmd. В терминале plugin регистрирует сервер сам
   (`plugin:worfy:qmd`), и инструменты называются так же: `mcp__plugin_worfy_qmd__…`.

Попутно (для ADR-0021): SDK-сервер в процессе (`createSdkMcpServer`, так устроен `worfy-canvas`)
список `allowedMcpServers` не фильтрует: он был в Session при пустом списке и при списке без
него. Сегодня worfy и так добавляет `worfy-canvas` только когда он в списке
(`src/main/agent/options.ts:120-126`), так что поведение worfy от этого не меняется.

**Что меняется в прежних ADR.**

- ADR-0040, пункт 1: «грузится на месте, без копии» уточняется — грузится на месте, но Claude Code
  всё равно кладёт копию в `~/.claude/plugins/cache/<marketplace>/worfy/<version>/`, а uninstall
  оставляет её с `.orphaned_at`. Одна папка может быть и marketplace-ом, и plugin-ом
  (`source: "./"`).
- ADR-0040, пункт 4: «переустанавливает plugin, когда строки разные» — это `plugin update … --scope
  user`, а не повторный `install`. Версия `<semver>+<SHA>` годится: смена одного SHA и откат
  версии записываются.
- ADR-0040, «Последствия», последний пункт: пункты 1 и 4 проверены опытом, расхождения — два
  уточнения выше.
- ADR-0041: не меняется. Метка `SessionStart` до Subagent-ов (обоих видов) не доходит, поэтому
  правила Subagent-а — только через `SubagentStart`, как он и решил.
- ADR-0043, пункт 3: «MCP-сервер qmd регистрирует сам plugin» остаётся для терминала. В
  Session-ах worfy сервер регистрирует worfy под именем `plugin_worfy_qmd` (пункт 4 выше); имена
  инструментов `mcp__plugin_worfy_qmd__…` те же.
- ADR-0021: имя qmd по умолчанию в списке — `plugin_worfy_qmd`, а не `qmd`.

**Последствия.**

- Ticket 05 (правила через hooks) и Ticket 06 (skills `epic-wave` и `ship-ticket`): запасной путь
  для агентов workflow-скриптов не нужен. Hook может выбирать часть правил по `agent_type`
  (`workflow-subagent`).
- Ticket 11 (Profile schema 2): значения `mcp.allowed` — имена серверов в Session worfy; для qmd из
  Harness это `plugin_worfy_qmd`, `qmd` — сервер пользователя.
- Ticket 13 (установщик): команды и коды выхода — пункт 3. Сеть и вход не нужны. Повторный запуск
  безопасен, кроме повторного `uninstall` (exit 1). Смену версии ставит `update`. Uninstall не
  убирает marketplace и копии в `plugins/cache`.
- Ticket 17 (qmd в Harness): `src/main/agent/options.ts` передаёт plugin inline с
  `skipMcpDiscovery: true` и регистрирует его серверы под `plugin_worfy_<сервер>`;
  `DEFAULT_MCP_SERVERS` — `['plugin_worfy_qmd', 'worfy-canvas']`. Test ждёт в `allowedMcpServers`
  `plugin_worfy_qmd`. Если plugin заведёт второй MCP-сервер, он пройдёт по тому же правилу.
- Ticket 18 (`GH_TOKEN`): основной путь. Строка в `CLAUDE_ENV_FILE` вызывает `gh` на каждой команде
  Bash — это лишний процесс на команду.
- Ticket 12 получает фикстуры `test/fixtures/sdk-messages/plugin-*.jsonl`: обезличенные
  `system/init` с plugin-ом inline и в области пользователя, `plugins`, `mcp_servers`, имена
  инструментов.
- Spike запускает настоящий Claude Code, и тот пишет транскрипты своих Session-ов в
  `~/.claude/projects/<временная папка>/` и служебные поля `~/.claude.json` (кэш флагов, счётчики
  skills и plugin-ов). Пересъёмка повторит эти записи.

## Considered Options

- **Вопрос 1.** Основной путь — `SubagentStart` у агентов workflow-скрипта (выбрано: работает).
  Запасной — правила в тексте каждого `agent()` из skill `epic-wave` — не понадобился.
- **Вопрос 2.** Основной путь — `GH_TOKEN` через `CLAUDE_ENV_FILE` из hook-а `SessionStart`
  (выбрано: работает в SDK и в терминале, у всех видов Subagent-ов). Запасной — worfy кладёт
  `GH_TOKEN` в env своих Session-ов, в терминале ручной `export` — отвергнут: токен лежал бы в env
  процесса Claude Code и всех его потомков, а терминальные Session-ы остались бы без него.
- **Вопрос 3.** Установка `marketplace add` + `install --scope user`, смена версии — `update`
  (выбрано). Удалять и ставить заново при каждой смене версии — отвергнуто: `update` делает это
  одной командой с exit 0, а uninstall оставляет копии в `plugins/cache`.
- **Вопрос 4, сервер plugin-а в списке по `serverCommand`.** Отвергнуто: путь в записи меняется с
  каждой копией plugin-а, а одна запись `serverCommand` отключает в списке все stdio-серверы,
  названные по имени, — worfy пришлось бы переводить в команды весь `mcp.allowed`, читая конфиги
  пользователя.
- **Вопрос 4, `qmd` пользователя вместо сервера plugin-а** (оставить `qmd` в списке).
  Отвергнуто: противоречит ADR-0043 (qmd — часть Harness) и у нового пользователя этого сервера
  нет.
- **Вопрос 4, без `allowManagedMcpServersOnly`** (список запретов вместо списка разрешений).
  Отвергнуто ADR-0021: каждый новый сервер пользователя снова попадает к агентам.
- **Вопрос 4, worfy регистрирует сервер под именем `qmd`.** Отвергнуто: инструменты назывались бы
  `mcp__qmd__…` в worfy и `mcp__plugin_worfy_qmd__…` в терминале, а строки `tools` agents Harness
  одни на оба случая; вдобавок имя столкнулось бы с `qmd` пользователя.
