# 11 — Проверка источника через connector claude.ai: одноразовый вызов Haiku 5.5 только с read tools одного connector-а

Type: task
Status: claimed 2026-11-25T14:09Z
Blocked by: 03
Source: [spec.md](../spec.md), «Ticket-ы», строка 11; «Решения владельца», 2, 13 и 19; «Решения по реализации» →
«Проверка источников через connectors claude.ai (решение владельца, вариант В)»; «Риски» («Connectors claude.ai»,
«Haiku 5.5 думает всегда»); «Решения по test-ам»; история 27; «Волны», Wave 2;
[`worfy-polish` 135](../../worfy-polish/issues/135-одноразовые-вызовы-haiku-на-haiku-5-5.md) (одноразовые вызовы Haiku
на Haiku 5.5).
Блокер из другого Epic-а: `worfy-polish` 135 — переход Terminal AI на Haiku 5.5 (done 2026-11-20, PR #2063);
`Blocked by` читает только номера этого Epic-а.

Кто: агент.

## Что строить

1. **Первый шаг — проверка двух вещей:**
   - можно ли оставить в вызове один connector и только его read tools;
   - сколько места в контексте займут tools connector-ов. С 634 tools у Haiku второй ход уже падал с «Prompt is too
     long» (ADR-0021).

   Если ограничить вызов нельзя, Ticket останавливается и возвращается к владельцу с вариантами.
2. **Какие connectors подключены** main узнаёт без вызова модели — из списка MCP-серверов, который Claude Code уже отдаёт
   worfy. Своих token-ов для Slack и Jira у worfy нет.
3. **Одна проверка — один одноразовый вызов Haiku 5.5** (thinking включено всегда). В вызове только read tools одного
   connector-а: ни tools Claude Code, ни `worfy-app`, ни настроек Project-а. Образец изоляции — narrator.
4. **Рецепт источника** говорит вызову, что искать и какие tools разрешены. Сами рецепты — Ticket-ы 12 (Slack) и 13
   (Jira).
5. **Выход** — структурированные пункты: источник, id, автор, время, ссылка, короткий текст, касается ли пользователя,
   срочно ли, к какому Project-у или Ticket-у относится. main проверяет форму. Ответ, который проверку не прошёл,
   пунктом не становится и пишется в журнал.
6. **Пункты источников** идут в ядро внимания (Ticket 03); к Session Assistant-а они приходят как данные, с источником
   и автором. Сама Session по-прежнему видит только tools `worfy-app`.

## Где в коде

- Образец изоляции — `src/main/vendors/claude/narrator.ts` (без настроек пользователя и Project-а, без MCP, без tools,
  Haiku 5.5); одноразовый вызов — `src/main/vendors/claude/one-shot.ts`, `src/main/vendors/one-shot.ts`.
- Список MCP-серверов Claude Code без вызова модели — `src/main/vendors/claude/mcp-inventory.ts`.
- [ADR-0021](../../../docs/adr/0021-mcp-servers-allowlist-in-profile.md) — «Prompt is too long» с 634 tools.

## Решения

- Slack и Jira — через connectors claude.ai, вариант В; своих token-ов у worfy нет (решение 19).
- Текст Slack и Jira сортирует Haiku 5.5 (решения 2 и 13).
- Состав вызова, выход, проверка формы в main, первый шаг и остановка, если ограничить нельзя (spec, «Проверка
  источников через connectors claude.ai»).

## Test-ы

- Проверки подают пункты в стык А; ответы вызова записаны как fixture-ы, поэтому test-ы не вызывают модель и не ходят в
  сеть (spec, «Решения по test-ам»).
- Unit test опций вызова читает ровно то, что уходит в SDK, — как у narrator.

## Готово, когда

- [ ] В «Итог» — результат первого шага: можно ли оставить в вызове один connector и только его read tools, и сколько
      места в контексте занимают tools connector-а. Если нельзя — Ticket в `blocked` с `Waits: owner` и вариантами.
  - evidence: commit pass · Check a source through one claude.ai connector with Haiku 5.5 and its read tools (worfy-assistant 11) · - - · 7f1043387
- [ ] Unit test: список подключённых connectors main берёт из списка MCP-серверов Claude Code без вызова модели.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/connector-check-options.test.ts` exit 0 · mac - · 5749a9b71c634ae3f3fe41fb47efd5b9fafde82d
- [ ] Unit test опций: вызов — Haiku 5.5, один connector, только его read tools; нет tools Claude Code, `worfy-app` и
      настроек Project-а.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/connector-check-options.test.ts` exit 0 · mac - · 5749a9b71c634ae3f3fe41fb47efd5b9fafde82d
- [ ] Unit test на записанных ответах: правильный ответ даёт пункты со всеми полями из «Что строить», 5; ответ неверной
      формы пунктом не становится и пишется в журнал.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-source-check.test.ts` exit 0 · mac - · 5749a9b71c634ae3f3fe41fb47efd5b9fafde82d
- [ ] Test-ы не вызывают модель и не ходят в сеть.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/connector-check-options.test.ts test/unit/assistant-source-check.test.ts` exit 0 · mac - · 5749a9b71c634ae3f3fe41fb47efd5b9fafde82d
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 5749a9b71c634ae3f3fe41fb47efd5b9fafde82d
  - evidence: gate pass · `gate fast` exit 0 · mac - · 5749a9b71c634ae3f3fe41fb47efd5b9fafde82d

## Итог

- Красный до правки: `node scripts/vitest-electron.mjs test/unit/connector-check-options.test.ts
  test/unit/assistant-source-check.test.ts` — exit 1, оба файла не грузятся: нет
  `src/main/vendors/claude/connector-check.ts`, `src/main/assistant/sources/connector-check.ts` и
  `src/shared/assistant/source-items.ts`.
- **Первый шаг — ответ: ограничить можно**, решено по типам и документации SDK 0.3.322 (`sdk.d.ts`) и коду worfy, без
  живого вызова:
  - один connector — policy tier с одной записью `allowedMcpServers: [{ serverUrl: <адрес connector-а> }]` и
    `allowManagedMcpServersOnly: true`; так Session-ы пропускают connector-ы с worfy-mcp-live 12 (`mcp-addresses.ts`).
    Других серверов нет: `settingSources: []`, `mcpServers: {}`, без plugin-ов. `strictMcpConfig` не годится: с
    `--strict-mcp-config` Claude Code не грузит ни одного connector-а claude.ai (spike worfy-mcp-live 11, причина
    `restricted`);
  - только read tools — `tools: ['StructuredOutput']` (из встроенных только structured answer), `disallowedTools` —
    `ONE_SHOT_DISALLOWED_TOOLS` и все остальные tools connector-а («removed from the model's context», `sdk.d.ts`),
    `allowedTools` — read tools под `permissionMode: 'dontAsk'`, `canUseTool` отказывает всему остальному. Имена tools —
    `mcp__<ключ сервера>__<tool>`, ключ connector-а — как в Claude Code 2.1.322 (`claude.ai Slack` →
    `claude_ai_Slack`, строка функции нормализации в бинарнике SDK);
  - место в контексте: в вызове только read tools одного connector-а, а не 634 tools (ADR-0021). Точное число зависит от
    схем tools connector-а, их `mcpServerStatus()` не отдаёт, поэтому worfy меряет его на каждом вызове: до отправки
    сообщения `getContextUsage({ detail: 'summary' })` (локальная оценка Claude Code, без вызова модели) называет tools в
    контексте и их token-ы. Потолок — `CONNECTOR_TOOLS_MAX_TOKENS` = 20 000 token-ов; выше — вызов отказан;
  - проверка перед моделью (`askConnector`): сообщение держится, пока `mcpServerStatus()` не покажет один этот connector
    в `connected`, а `getContextUsage()` — только его read tools, без Bash, записи и сети, не выше потолка. Иначе Claude
    Code закрывается без сообщения: модель не вызвана, расхода нет, строка в журнале.
- Какие connectors подключены — `listConnectors`: query инвентаря MCP (`sdkInventoryStarter`, настройки пользователя,
  ни одного сообщения — модели нет), `mcpServerStatus()` → `connectorsOf`: серверы со scope `claudeai`, их адрес, статус
  и tools с аннотациями `readOnly` и `destructive`.
- Вызов — `connectorCheckOptions` (чистая функция, unit test читает ровно то, что уходит в SDK): Haiku 5.5 по id
  (`claude-haiku-5-5`), без переключателя thinking, папка `<WORFY_DATA_DIR>/assistant-sources` вне Project-ов, без
  transcript-а, без API-ключей, `maxTurns` 8, `CLAUDE_CODE_MAX_OUTPUT_TOKENS` 8192, ответ — `outputFormat` со схемой
  пунктов. Код — `src/main/vendors/claude/connector-check.ts`.
- Выход и проверка формы — `src/shared/assistant/source-items.ts`: пункт — источник, id, автор, время ISO 8601 со
  смещением, https-ссылка, короткий текст, касается ли пользователя, срочно ли, Project и Ticket (или null); не больше
  30 пунктов. Ответ вне формы целиком — ни одного пункта, строка в журнале, проверка падает (планировщик оставляет
  `since` на прошлом успехе). Пункт неверной формы или от другого источника — не пункт, строка в журнале с номером и
  полями, без текста источника; остальные пункты идут.
- Пункты — в ядро внимания (`src/main/assistant/sources/connector-check.ts`, `sourceCheckRun` — `CheckRun`
  планировщика Ticket-а 04): событие источника `slack` или `jira` (виды проверок Ticket-а 04 добавлены в
  `ATTENTION_SOURCES`), предмет `message` с автором, вид `message` или `urgent-message`, ревизия — время сообщения; поля
  сообщения лежат в пункте как `message` (`sourceMessageSchema`, `src/shared/assistant/attention.ts`). Project — по
  имени из ответа среди Project-ов машины, иначе пункт машины. Вызов, дошедший до модели, — `noteCall` журнала расхода
  Ticket-а 05 (`source-check`, источник, модель, `usage`, `costUsd`), и когда ответа не было.
- Регистрация в приложении — `appSourceCheck(recipe)` в `src/main/assistant/sources/app.ts`; Ticket-ы 12 и 13
  регистрируют рецепт: `checkScheduler().register(kind, appSourceCheck(recipe))`. Под `WORFY_AGENT=fake` проверка не
  запускается. `src/main/index.ts` не менялся.
- Решено без владельца (подтвердить):
  - read tool — tool, который назвал рецепт, есть у connector-а и не помечен как пишущий (`readOnly: false` или
    `destructive: true`); tool без аннотаций, названный рецептом, разрешён — список рецепта и есть решение;
  - потолок tools connector-а в контексте — 20 000 token-ов; `maxTurns` 8; предел ответа 8192 token-а с thinking; не
    больше 30 пунктов в ответе;
  - первая проверка вида без прошлого успеха смотрит на сутки назад;
  - журнал отказов до журнала Assistant-а (Ticket 08) — лог main (`console.warn`, строки `[assistant] the <kind>
    check: …`), без текста сообщений;
  - нет connector-а, connector ждёт входа в claude.ai, вызов отказан, без ответа или ответ вне формы — проверка
    падает, следующая покрывает то же время;
  - `src/main/index.ts` не трогается: проверку регистрирует рецепт (Ticket-ы 12 и 13).
- Не проверено вживую (первый настоящий вызов — приёмка Ticket-а 12): что `getContextUsage({ detail: 'summary' })`
  отвечает до первого сообщения; что запись `serverUrl` пропускает настоящий connector (тот же открытый ручной пункт
  worfy-mcp-live 12 / 08); сколько token-ов занимают read tools настоящего connector-а Slack.
