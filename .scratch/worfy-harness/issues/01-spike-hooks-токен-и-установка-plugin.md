# 01 — Spike: hooks у Subagent-ов workflow-скриптов, `GH_TOKEN` через `CLAUDE_ENV_FILE`, установка plugin и имя его MCP-сервера → ADR-0048

Type: research
Status: claimed — 2026-10-07
Blocked by: —
Source: решения владельца 2026-10-07 (Q1, Q2, Q8, Q9, Q12, Q15, Q21; «Факты spike»); [spec.md](../spec.md); [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md); [ADR-0041](../../../docs/adr/0041-harness-rules-via-session-hooks.md); [ADR-0043](../../../docs/adr/0043-qmd-is-part-of-harness.md); [ADR-0021](../../../docs/adr/0021-mcp-servers-allowlist-in-profile.md); [ADR-0035](../../../docs/adr/0035-workflow-script-subagents-in-tree.md); [ADR-0007](../../../docs/adr/0007-claude-code-launch-environment.md)

## Что происходит

- Harness станет plugin-ом `worfy` (ADR-0040). Spike 2026-10-07 (SDK 0.3.289, встроенный Claude Code
  2.1.289) проверил пять фактов. Plugin-ы из области пользователя грузятся при `settingSources` с
  `user`. `plugins: [{type: 'local', path}]` с тем же именем молча заменяет установленный plugin.
  `bin/` plugin-а лежит в PATH у Bash главной Session и Subagent-а. `${CLAUDE_PLUGIN_ROOT}`
  подставляется в текст SKILL.md. Hooks `SessionStart` и `SubagentStart` с `additionalContext`
  доходят до главной Session и до Subagent-а. Скрипты того spike лежат в scratchpad Session, в
  репозитории их нет — повторить их из репозитория нельзя.
- Не проверены четыре вещи. От них зависят Ticket-ы 05 (правила для hooks), 06 (skills
  `epic-wave` и `ship-ticket`), 11 (Profile schema 2), 13 (установщик), 17 (qmd) и 18 (`GH_TOKEN`
  у Session-ов):
  1. Доходят ли hooks plugin-а до Subagent-ов workflow-скриптов. Wave в Autopilot идёт через
     workflow-скрипт (инструмент `Workflow` Claude Code). Его агенты — отдельный вид Subagent-а:
     `meta.json` с `agentType: workflow-subagent`, файлы в `<sessionId>/subagents/workflows/<runId>/`
     ([ADR-0035](../../../docs/adr/0035-workflow-script-subagents-in-tree.md),
     `src/main/claude-home/subagents.ts:9`). Правила Subagent-а придут через `SubagentStart` (Q9).
  2. Работает ли `GH_TOKEN` аккаунта Project-а через `CLAUDE_ENV_FILE` (Q21). Сейчас токен ставят
     руками в каждую команду: `~/.claude/skills/epic-wave/SKILL.md:70`, `:152`,
     `~/.claude/skills/ship-ticket/SKILL.md:91`, `~/.claude/agents/implementer.md:79`. Собственный
     `gh` worfy берёт токен сам (`src/main/github/prs.ts:13-18`).
  3. Как ставится plugin из локального marketplace встроенным бинарём SDK (Q1): коды выхода,
     повторный запуск, обновление при смене `version` (Q12). Бинарь —
     `claudeExecutablePath` (`src/main/agent/options.ts:46`): в собранном приложении
     `app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude`, в
     dev — тот же пакет в `node_modules` (`@anthropic-ai/claude-agent-sdk-darwin-arm64@0.3.289`).
     `plugin --help` этого бинаря знает `marketplace`, `install`, `enable`, `validate`.
  4. Каким именем MCP-сервер plugin-а проходит через список MCP-серверов Project-а. worfy передаёт
     список как `managedSettings.allowedMcpServers` из `{serverName}` с
     `allowManagedMcpServersOnly: true` (`src/main/agent/options.ts:116-118`). Список по умолчанию —
     `qmd` и `worfy-canvas` (`DEFAULT_MCP_SERVERS`, `src/main/workflow/profile.ts:25`). Сейчас `qmd`
     — сервер пользователя из `~/.claude.json`. По Q15 его регистрирует сам plugin (`.mcp.json`), а
     инструменты называются `mcp__plugin_worfy_qmd__…`.
- Session-ы worfy идут с `settingSources: ['user', 'project', 'local']`
  (`src/main/agent/options.ts:97`); `plugins` worfy пока не передаёт.
- Прошлый spike Project-а — `scripts/spikes/sdk-probe.ts` (Ticket 06 `worfy-mvp`): запуск
  `pnpm exec electron …`, вывод без путей и секретов, фрагменты сообщений SDK —
  `test/fixtures/sdk-messages/`.

## Что делаем

Итог — факты с выводом команд и ADR-0048, а не код для продакшена. `src/`, `~/.claude` и
настоящие настройки пользователя не меняются.

1. **Spike — в репозитории.** `scripts/spikes/harness-plugin/`: скрипт `probe.ts` (запуск, как у
   `sdk-probe.ts`: `pnpm exec electron scripts/spikes/harness-plugin/probe.ts <сценарий>`), plugin-
   образец `fixture/` с именем `worfy` (`.claude-plugin/plugin.json`, `hooks/hooks.json`, `bin/`,
   `.mcp.json` с крошечным stdio-сервером на node), локальный marketplace `marketplace/` для
   сценария установки. Шапка `probe.ts` описывает каждый сценарий одной командой. Модель — sonnet,
   запросы короткие.
2. **Сценарий `known`.** Повторяет пять фактов spike 2026-10-07 одним запуском (plugin inline
   поверх установленного, `bin/` в PATH главной Session и Subagent-а, `${CLAUDE_PLUGIN_ROOT}` в
   SKILL.md, `SessionStart` и `SubagentStart`). Так они воспроизводятся из репозитория.
3. **Сценарий `workflow-hooks`** (Q9, ADR-0041). Hooks `SessionStart` и `SubagentStart` образца
   отдают в `additionalContext` разные метки и пишут в файл вывода spike строку с `agent_type` из
   входа hook-а. Главная Session (SDK, `settingSources` как у worfy, plugin inline) запускает
   workflow-скрипт с одним агентом. Агент отвечает, видит ли он метку `SubagentStart` и находит ли
   в PATH команду из `bin/` образца. Ответ — да/нет по каждому, плюс `agent_type`, с которым
   сработал hook. Если метка не доходит — ADR-0048 называет запасной путь для правил Subagent-а
   workflow-скрипта и Ticket-ы, которые меняются (05, 06).
4. **Сценарий `env-file`** (Q21). Hook `SessionStart` образца дописывает в `$CLAUDE_ENV_FILE`
   строку `export GH_TOKEN="$(gh auth token -u <account>)"` буквально, без подстановки при записи.
   Первым в PATH стоит подменённый `gh`: он печатает заранее известный фальшивый токен и считает
   свои вызовы в файле. Ответить:
   - задан ли `CLAUDE_ENV_FILE` hook-у plugin-а у встроенного бинаря SDK и у `claude` из терминала
     (`claude -p … --plugin-dir`);
   - исполняет ли Claude Code файл как shell перед каждой командой Bash: на N команд Bash — N
     вызовов `gh`;
   - видят ли `GH_TOKEN` Bash главной Session, Subagent-а и Subagent-а workflow-скрипта;
   - нет ли значения токена в транскрипте, выводе hook-а и выводе spike-а.

   Агент проверяет токен по хешу (`printf %s "$GH_TOKEN" | shasum -a 256`), значение не
   печатается. Затем одна проверка с настоящим `gh`: аккаунт Project-а worfy
   (`~/.claude/bin/profile -C <корень worfy> --field github.account`, сейчас `IDSAD-XL`), в Bash
   Session — `gh api user --jq .login`, ответ — имя аккаунта. Глобальный аккаунт `gh` не
   переключается: никаких `gh auth switch` и `gh auth login`. Не работает — ADR-0048 записывает
   запасной путь из Q21: worfy кладёт `GH_TOKEN` в env своих Session-ов, в терминале остаётся
   ручной `export`.
5. **Сценарий `install`** (Q1, Q8, Q12) — только в песочнице: `HOME` и `CLAUDE_CONFIG_DIR` во
   временной папке. Встроенным бинарём SDK, каждая команда дважды, с кодом выхода и выводом
   (`--json`, где есть):
   - `plugin validate` образца и marketplace;
   - `plugin marketplace add <папка marketplace>`;
   - `plugin install worfy@<marketplace> --scope user`;
   - где лежит установленный plugin: грузится на месте из папки marketplace или из копии в
     `plugins/cache/` (вывод `plugin list --json` и файлы песочницы);
   - смена `version` в `plugin.json` образца: какая команда ставит новую версию (`plugin update`,
     повторный `install`), её код выхода, что показывает `plugin list` после;
   - `plugin uninstall`;
   - нужны ли этим командам сеть или вход в Claude. Если нужен вход — это находка для ADR-0048, а
     не шаг владельца: `/login` в песочнице владелец делает только для приёмки (Ticket 26).
6. **Сценарий `mcp-name`** (Q15, ADR-0021, ADR-0043). `.mcp.json` образца объявляет сервер `qmd` с
   одним инструментом. Session через SDK с `managedSettings` как у worfy
   (`allowManagedMcpServersOnly: true`) и разными `allowedMcpServers`: `qmd`; имя plugin-сервера в
   том виде, в каком его показывает `system/init`; без записи. Записать по каждому варианту: имена
   и статус серверов в `system/init.mcp_servers`, имена инструментов. Отдельно — запуск, когда у
   пользователя есть свой `qmd` в `~/.claude.json` (так на машине владельца): видны ли оба сервера,
   под какими именами, пропускает ли одна запись списка оба. Ответ: какую строку пишет поле Profile
   `mcp.allowed` для `qmd` из plugin-а и меняется ли `DEFAULT_MCP_SERVERS`.
7. **ADR-0048** — `docs/adr/0048-harness-plugin-spike-results.md`, номер выдан заранее. По каждому
   вопросу — вывод и выбранный путь (основной или запасной). Отдельно — версии SDK, встроенного
   Claude Code и `claude --version` терминала. Названы Ticket-ы, которых касается вывод: 05, 06,
   11, 13, 17, 18. Если вывод противоречит ADR-0040, 0041 или 0043 — ADR-0048 говорит, что именно
   он уточняет; принятые ADR не правятся.
8. **Фикстуры.** Очищенные сообщения `system/init` с plugin-ом inline (поля `plugins`,
   `plugin_errors`, `mcp_servers`, имена инструментов) — `test/fixtures/sdk-messages/plugin-*.jsonl`,
   для contract test-ов Ticket-а 12. Без путей пользователя, без текста prompt-ов, без токенов.

**Не входит:** код worfy (`src/`), файлы Harness, `harness/` (появляется в Ticket-е 02), установка
plugin-а на настоящий `~/.claude`.

## Готово, когда

- [x] На каждый из вопросов пунктов 3–6 в «Итог» есть ответ с выводом spike-а: команда, код выхода, фрагмент вывода; указаны версии SDK, встроенного Claude Code и `claude --version` терминала.
- [x] Spike лежит в `scripts/spikes/harness-plugin/`; каждый сценарий запускается одной командой из шапки `probe.ts`; `pnpm lint` — exit 0.
- [x] Сценарий `install` не трогает настоящие файлы: `shasum ~/.claude/settings.json ~/.claude/plugins/installed_plugins.json ~/.claude/plugins/known_marketplaces.json` до и после прогона совпадают; оба вывода — в «Итог».
- [x] Фальшивого токена нет в выводе spike-а и в транскриптах его Session-ов: `grep -rlF '<фальшивый токен>' <папка вывода> <файлы транскриптов spike-а>` — exit 1 (совпадений нет). Настоящий токен сравнивается только в памяти и нигде не печатается.
- [x] `docs/adr/0048-harness-plugin-spike-results.md`: вторая строка «Дата: … Статус: принят.», раздел `## Considered Options`, по каждому из четырёх вопросов — вывод и путь, список затронутых Ticket-ов.
- [x] Фикстуры без путей пользователя и секретов: `grep -lE '/Users/|ghp_|gho_|github_pat_' test/fixtures/sdk-messages/plugin-*.jsonl` — exit 1.
- [x] `src/` не изменён: `git diff --quiet origin/main -- src` — exit 0.

## Тесты

Test-ов нет: результат — знание. Фикстуры `test/fixtures/sdk-messages/plugin-*.jsonl` нужны
contract test-ам Ticket-а 12; test-ы, которые их читают, пишет он.

## Где в коде

- `scripts/spikes/harness-plugin/probe.ts` (новый)
- `scripts/spikes/harness-plugin/fixture/` (новый) — plugin-образец `worfy`: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `bin/`, `.mcp.json` и его сервер
- `scripts/spikes/harness-plugin/marketplace/` (новый) — локальный marketplace для сценария `install`
- `docs/adr/0048-harness-plugin-spike-results.md` (новый)
- `test/fixtures/sdk-messages/plugin-*.jsonl` (новые)

Только чтение: `src/main/agent/options.ts`, `src/main/workflow/profile.ts`,
`src/main/claude-home/subagents.ts`, `~/.claude/bin/profile`. Общих файлов с Ticket-ами 02, 03 и
10 (та же Wave) нет.

## Итог

Вывод и выбранный путь по каждому вопросу — [ADR-0048](../../../docs/adr/0048-harness-plugin-spike-results.md).
Ниже — чем это снято.

- **Версии.** `@anthropic-ai/claude-agent-sdk` 0.3.289; встроенный Claude Code — `2.1.289 (Claude
  Code)`; `claude --version` терминала — `2.1.291 (Claude Code)`; Electron 44.5.1. Модель — haiku;
  SDK-Session сценария `env-file` — sonnet: haiku отказался выполнить шаг с хешем `GH_TOKEN`
  («would expose the GH_TOKEN environment variable»).
- **Прогон.** `pnpm exec electron scripts/spikes/harness-plugin/probe.ts known workflow-hooks
  env-file install mcp-name --out <tmp> --fixtures test/fixtures/sdk-messages` — exit 0; затем
  `… install mcp-name …` ещё раз (без модели) — exit 0: добавились шаги версии `<semver>+<SHA>`
  и вариант `host-server` в `mcp-name`. Круг доработки (ревью гейта): `… mcp-name --fixtures
  test/fixtures/sdk-messages` (без модели) — exit 0, добавлены варианты `host-server-not-listed`,
  `host-server-allow-none`, `skip-discovery-no-allowlist`, `skip-discovery-allow-command`; затем
  `probe.ts --rescrub test/fixtures/sdk-messages` (без модели) — exit 0: UUID рядом с `_` теперь
  обезличены. Каждый сценарий запускается и отдельно, командой из шапки `probe.ts`.
- **`known`** — все пять фактов spike 2026-10-07 повторились. В песочнице `system/init` показал
  установленный `worfy@worfy-spike` 0.1.0 с путём папки marketplace, а с inline — один `worfy`,
  `source: worfy@inline`, `version: 9.9.9-inline`. В Session на настройках пользователя
  `worfy-spike-bin` запустили skill, главная Session и Subagent: у всех `plugin_bin_on_path: true`;
  skill передал путь plugin-а (`substituted: true`); главная Session видит метку `SessionStart`
  (`amber-5172`), Subagent — только метку `SubagentStart` (`cobalt-9038`, `NONE` вместо второй).
- **`workflow-hooks` (вопрос 1) — да.** Главная Session вызвала `Workflow` (`Workflow` есть в
  `system/init.tools`). `hooks.jsonl`: `SubagentStart` с `agent_type: workflow-subagent` и
  `agent_id`; `PreToolUse` того же агента — команда `worfy-spike-bin wf cobalt-9038 NONE`. Агент
  видит метку `SubagentStart`, не видит `SessionStart`, `plugin_bin_on_path: true`. `meta.json`
  агента — `agentType: workflow-subagent`, журнал — `result: "worfy-spike-bin ok wf token=no"`.
- **`env-file` (вопрос 2) — да.** `CLAUDE_ENV_FILE` задан hook-у `SessionStart` plugin-а у
  встроенного бинаря (`claude_env_file_set: true`) и у `claude -p --plugin-dir` терминала (`true`,
  exit 0). 5 команд Bash SDK-Session (3 главная, 1 `general-purpose`, 1 `workflow-subagent`) — 5
  вызовов `gh auth token -u IDSAD-XL` подменённого `gh`; терминал: 1 команда — 1 вызов. У всех
  четырёх `worfy-spike-bin` `gh_token_set: true`, sha256 = sha256 фальшивого токена; хеш из шага
  `printf %s "$GH_TOKEN" | shasum -a 256` совпал. Ещё 4 вызова `gh auth token --user …` — это
  hook Stop пользователя (`qmd-refresh` → `qmd-sync-main`, их git credential helper), не файл
  окружения. Настоящий `gh`: `gh_api_user_login: IDSAD-XL`, `token_is_the_accounts: true`,
  настоящий токен в транскриптах и в выводе spike-а — 0 файлов. `grep -rlF '<фальшивый токен>'
  <вывод spike-а> ~/.claude/projects/*worfy-harness-probe*` — exit 1.
- **`install` (вопрос 3).** Встроенный бинарь в песочнице без входа: `plugin validate` plugin-а и
  marketplace — 0, 0; `marketplace add` — 0, 0 («already on disk»); `install --scope user --json` —
  0 (`"outcome":"ok"`), 0 («already installed … loads in place»); `list --json` — `installPath` в
  `plugins/cache/worfy-spike/worfy/0.1.0`, `readFromFolder` — папка marketplace; Session грузит
  plugin из папки marketplace. Версия 0.2.0 в папке: `update --scope user` — 0 («updated from
  0.1.0 to 0.2.0»), повтор — 0 («already at the latest version»); `install` при 0.3.0 — 0, версия
  не меняется, совет вызвать `update`. `0.4.0+aaaaaaa` → `0.4.0+bbbbbbb` → `0.4.0+aaaaaaa` →
  `0.3.9+ccccccc`: каждый `update` — 0, `list` показывает новую строку, каталог копии
  `0.4.0-aaaaaaa`. `uninstall` — 0, повтор — 1 («not found in installed plugins»); после него
  `enabledPlugins: {}`, marketplace остаётся в `extraKnownMarketplaces`, копии в `plugins/cache` с
  `.orphaned_at`. Одна папка с `plugin.json` и `marketplace.json` (`source: "./"`) — `validate`,
  `marketplace add`, `install` — 0. С `HTTPS_PROXY`/`HTTP_PROXY` на `127.0.0.1:9` — `marketplace
  add`, `install`, `list`, `uninstall` — 0. Вход не нужен ни одной команде.
- **`mcp-name` (вопрос 4)** — песочница, `managedSettings` как у worfy, 17 вариантов списка × (без
  `qmd` пользователя / с ним). Сервер plugin-а — `plugin:worfy:qmd`, инструмент
  `mcp__plugin_worfy_qmd__plugin_ping`. `serverName` `qmd`, `plugin:worfy:qmd`, `plugin_worfy_qmd`,
  `worfy:qmd`, `worfy` — сервера plugin-а нет. `serverCommand: ['node', '<plugin>/mcp/server.mjs']`
  — есть; с `${CLAUDE_PLUGIN_ROOT}` в записи — нет. `[qmd, serverCommand plugin-а]` при `qmd`
  пользователя — только сервер plugin-а. Без списка с `qmd` пользователя видны оба (`qmd`,
  `source: user` и `plugin:worfy:qmd`). `skipMcpDiscovery: true` убирает сервер plugin-а: без
  списка и со `serverCommand` plugin-а его нет. Сервер worfy `plugin_worfy_qmd` в `mcpServers`
  список фильтрует по имени: `[plugin_worfy_qmd, qmd, worfy-canvas]` — подключены
  `plugin_worfy_qmd` (`mcp__plugin_worfy_qmd__plugin_ping`) и `qmd` пользователя;
  `[qmd, worfy-canvas]` — только `qmd`; `[]` — ни одного. Мимо списка проходит только SDK-сервер
  в процессе (`worfy-canvas`). Строка Profile
  `mcp.allowed` для qmd из plugin-а — `plugin_worfy_qmd`; `DEFAULT_MCP_SERVERS` →
  `['plugin_worfy_qmd', 'worfy-canvas']` — **решено без владельца, подтвердить** (ADR-0048,
  пункт 4).
- **Настоящие файлы.** `shasum ~/.claude/settings.json ~/.claude/plugins/installed_plugins.json
  ~/.claude/plugins/known_marketplaces.json ~/.claude.json` до (15:32) и после прогона:
  `506a889c…`, `a57d2b1b…`, `038f3125…` — совпали; `~/.claude.json` — `6cf2582b…` → `82d902f4…`.
  Изменились только служебные поля Claude Code (`cachedGrowthBookFeaturesAt`, `pluginUsage`,
  `skillUsage`, `clientDataCacheSlots`, `additionalModelOptionsAnsweredAt`); `mcpServers` и
  `projects` прежние. Их пишет любая Session на настройках пользователя, в том числе Session-ы
  spike-а. Сценарий `install` хеши не менял: хеши после него совпали с хешами до него.
- **Транскрипты spike-а** — 13 папок `~/.claude/projects/-private-var-folders-…-T-worfy-harness-probe-<id>-work-<сценарий>`
  (41 файл): последний полный прогон и пробные прогоны во время отладки. Их можно удалить.
- **Фикстуры** — 14 файлов `test/fixtures/sdk-messages/plugin-*.jsonl`, по одному `system/init`:
  `plugin-known-installed`, `plugin-known-inline-over-installed` (песочница),
  `plugin-known-user-settings`, `plugin-workflow-hooks-user-settings`, `plugin-env-file-sdk`
  (настройки пользователя, plugin-ы пользователя — `plugin-N`) и девять вариантов
  `plugin-mcp-name-*`. `grep -lE '/Users/|ghp_|gho_|github_pat_' test/fixtures/sdk-messages/plugin-*.jsonl`
  — exit 1. `accountUuid` и `organizationUuid` владельца (путь synced plugin-а
  `<accountUuid>_<organizationUuid>`) заменены на `00000000-0000-4000-8000-…19` и `…20`; их нет ни в
  одной фикстуре и ни в одном коммите ветки (проверено сравнением без печати значений).
- Фальшивый токен — `worfy-spike-fake-token-…`, не похож ни на один формат токена GitHub. Прогоны с
  моделью шли ещё с прежним фальшивым значением в формате `gho_`; после замены строки `env-file` не
  перезапускался.
- `git diff --quiet origin/main -- src` — exit 0.
