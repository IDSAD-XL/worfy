# 01 — Spike: hooks у Subagent-ов workflow-скриптов, `GH_TOKEN` через `CLAUDE_ENV_FILE`, установка plugin и имя его MCP-сервера → ADR-0048

Type: research
Status: open
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

- [ ] На каждый из вопросов пунктов 3–6 в «Итог» есть ответ с выводом spike-а: команда, код выхода, фрагмент вывода; указаны версии SDK, встроенного Claude Code и `claude --version` терминала.
- [ ] Spike лежит в `scripts/spikes/harness-plugin/`; каждый сценарий запускается одной командой из шапки `probe.ts`; `pnpm lint` — exit 0.
- [ ] Сценарий `install` не трогает настоящие файлы: `shasum ~/.claude/settings.json ~/.claude/plugins/installed_plugins.json ~/.claude/plugins/known_marketplaces.json` до и после прогона совпадают; оба вывода — в «Итог».
- [ ] Фальшивого токена нет в выводе spike-а и в транскриптах его Session-ов: `grep -rlF '<фальшивый токен>' <папка вывода> <файлы транскриптов spike-а>` — exit 1 (совпадений нет). Настоящий токен сравнивается только в памяти и нигде не печатается.
- [ ] `docs/adr/0048-harness-plugin-spike-results.md`: вторая строка «Дата: … Статус: принят.», раздел `## Considered Options`, по каждому из четырёх вопросов — вывод и путь, список затронутых Ticket-ов.
- [ ] Фикстуры без путей пользователя и секретов: `grep -lE '/Users/|ghp_|gho_|github_pat_' test/fixtures/sdk-messages/plugin-*.jsonl` — exit 1.
- [ ] `src/` не изменён: `git diff --quiet origin/main -- src` — exit 0.

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

Заполняется при закрытии.
