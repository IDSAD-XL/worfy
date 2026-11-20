# 06 — Proxy и Session Claude: `@modelcontextprotocol/sdk` прямой зависимостью, `McpServer` с JSON Schema сервиса, одно соединение на Integration, фильтр tools, «Sign-in needed», SDK-серверы в `mcpServers`

Type: task
Status: claimed 2026-11-20T22:02Z
Branch: worfy-integrations/06
Blocked by: 01, 03, 04
Source: [spec.md](../spec.md), «Ticket-ы», 6; «Волны», Wave 3; «Решение», 1, 4 и 5; «Как пользователь идёт по
экранам», 5, 8 и 9; «Факты», 3а–3д; «Решения по реализации» → Имя сервера в Session, Proxy, Session Claude, Статус,
Цена tools; «Решения по test-ам»; «Риски» (proxy не покрывает сервис, worfy закрыт, два набора одного сервиса, имя
tool-а длиннее предела); «Вопросы владельцу», Q1 и Q9; «Решено без владельца», 2 и 4;
[critic](../../../docs/product/critic/worfy-integrations-2026-11-20.md), возражения 1 и 2

Кто: агент.

Платформенный Ticket (ADR-0056): worfy сам запускает stdio-процесс сервиса — на Windows свои правила запуска команды
(`.cmd`, PATH); вердикт Windows — job-ы Windows в CI. Глубина ревью — `high`: token сервиса не должен попасть в
аргументы процесса, лог, Journal и Flight recorder.

## Что происходит

- Q1 (а): Session ходит к Integration через worfy. Свои серверы worfy описаны как `McpServer`
  (`src/main/vendors/mcp.ts:60-75`); Claude получает их SDK-сервером в процессе worfy
  (`src/main/vendors/claude/mcp.ts:209-231`, `src/main/vendors/claude/options.ts:829-842`), но
  `createSdkMcpServer` (`mcp.ts:220-228`) принимает только zod shape, а tools сервиса приходят готовой JSON Schema.
- `sdkQueryFactory` (`src/main/vendors/claude/query.ts:310-367`) собирает серверы Session Project-а и отдаёт
  `sessionOptions`. Policy tier (`managedSettings.allowedMcpServers`, `options.ts:805-819`) не трогает серверы,
  переданные в `mcpServers` при старте (`options.ts:29-30`); `mcp.allowed` Integration-ы не называет (Q9).
- Факт 3в: заголовок с token-ом в записи `http` ушёл бы в `--mcp-config` и был бы виден в `ps`; SDK-сервер в процессе
  worfy этого не имеет.
- `@modelcontextprotocol/sdk` 1.32.0 уже стоит peer-ом `@anthropic-ai/claude-agent-sdk` 0.3.322
  (`pnpm-lock.yaml:3929-3932`, диапазон `^1.29.0` — `pnpm-lock.yaml:212-215`); возражение 2 critic-а: пакет —
  прямая зависимость той же версии, второй копии в сборке нет.
- Записка spike-а 01 (`.scratch/worfy-integrations/spike-integrations.md`) отвечает: работают ли две Integration-ы на
  одном адресе рядом с `managedSettings`, предел длины имени tool-а, достаточно ли tools-only proxy.
- Заголовок входа по token-у — `src/main/integrations/auth/tokens.ts` (Ticket 04). Место `authProvider` для OAuth
  остаётся пустым до Ticket-а 05.

## Что делаем

1. `package.json`: `@modelcontextprotocol/sdk` 1.32.0 — прямая зависимость (версия из `pnpm-lock.yaml`, как у peer-а
   Agent SDK); в lock-файле одна копия пакета.
2. `McpTool` (`src/main/vendors/mcp.ts`) получает второй вид входа — готовую JSON Schema сервиса вместо zod shape;
   SDK-сервер Claude для Integration строится на низкоуровневом `Server` MCP SDK, а не на `createSdkMcpServer`.
3. `src/main/integrations/proxy.ts` (новый): сторона сервиса — `Client` со `StreamableHTTPClientTransport` (с
   `Mcp-Session-Id`, если сервер его даёт; место `authProvider` пустое до 05) или stdio-процесс, который worfy
   запускает сам, с секретами в окружении, не в аргументах. Одно соединение на Integration и Machine, общее для всех
   Session-ов; `tools/list` кэшируется на время Session; заголовок token-а — из 04 при каждом соединении.
4. Proxy передаёт tools: текст, картинки, ссылки на ресурсы. Фильтр tools Project-а (`all`, `read-only` по
   `readOnlyHint`, список) режет и `tools/list`, и `tools/call`. В описание каждого tool-а proxy дописывает метку
   («[Jira — client A]»). Отказ входа (401 при token-е) → ответ tool-а `isError` «Sign-in needed: <метка>. Ask the user
   to sign in in worfy» и статус `needs-sign-in`. Если записка 01 сказала «tools-only proxy недостаточен» —
   добавленное по ней, с решением в «Итог».
5. Цена tools: длина JSON описаний и схем tools Integration, делённая на 4, — оценка token-ов; число и размер — в
   статусе Integration (их показывает Ticket 08).
6. Имя сервера в Session: slug метки — латиница, цифры, `-`, не длиннее 24 символов (или предела из записки 01);
   уникально в Project-е; не совпадает ни с сервером Claude Code из последнего ответа инвентаря
   (`src/main/vendors/claude/mcp-inventory.ts`), ни с префиксом `worfy-`; совпадение — суффикс `-2` и предупреждение
   в строке.
7. Session Claude: `sdkQueryFactory` получает включённые Integration-ы Project-а вместе с canvas и отдаёт их в
   `mcpServers` SDK-серверами рядом с `worfy-canvas`; Session вне Project-а их не получает; subagent-ы наследуют набор
   Session. Turn off for this Session у Integration — Restart без неё, как у сервера пользователя
   (`docs/features/mcp-servers.md`).
8. Строки chip-а «MCP n/m» для Session Claude: источник `integration` и метка в строке Integration
   (`src/shared/agent/mcp-status.ts`, `mcp-inventory.ts`); действие Sign in у строки — Ticket 09.
9. worfy закрыт или перезапущен — Session, пережившая рестарт, получает ошибку tool-а до Restart; текст ошибки
   называет Integration.

## Готово, когда

- [ ] Contract `test/contract/integrations-proxy.test.ts` (новый) на stub-ах `test/fixtures/integrations/`: две
      Integration-ы на одном адресе stub-а с разными token-ами отвечают каждая своими данными; одно соединение на
      Integration при двух Session-ах; stdio-stub получает секрет в окружении, `args` секрета не держат. Красный до
      правки — в «Итог».
- [ ] Тот же contract: фильтр `read-only` и список режут `tools/list` и `tools/call` (вызов отфильтрованного tool-а —
      отказ); метка в описании tool-а; 401 → ответ `isError` «Sign-in needed: <метка>…» и статус `needs-sign-in`;
      размер tools — длина JSON / 4.
- [ ] Contract `test/contract/integrations-claude-session.test.ts` (новый) на fake query
      (`src/main/agent/fake-query.ts`): Session Project-а получает в `mcpServers` ровно его включённые Integration-ы
      рядом с `worfy-canvas`; `managedSettings` и `mcp.allowed` не изменились; Session вне Project-а их не получает;
      Turn off — Restart без неё.
- [ ] Тот же contract: значение token-а не появляется в аргументах процесса Claude Code (`--mcp-config`), в логе main, в
      Journal и в Flight recorder.
- [ ] Unit `test/unit/integration-server-name.test.ts` (новый): slug, предел длины, суффикс `-2` при совпадении с
      сервером Claude Code из инвентаря и с префиксом `worfy-`.
- [ ] `test/unit/mcp-status-row.test.ts`: строка с источником `integration` и меткой.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR, job-ы Windows CI зелёные
      (платформенный PR).

## Где в коде

- `package.json`, `pnpm-lock.yaml`
- `src/main/integrations/proxy.ts` (новый)
- `src/main/vendors/mcp.ts` (`McpTool` с JSON Schema), `src/main/vendors/claude/mcp.ts`, `src/main/vendors/claude/options.ts`,
  `src/main/vendors/claude/query.ts`
- `src/shared/agent/mcp-status.ts`, `src/main/vendors/claude/mcp-inventory.ts`
- `test/contract/integrations-proxy.test.ts`, `test/contract/integrations-claude-session.test.ts`,
  `test/unit/integration-server-name.test.ts` (новые), `test/unit/mcp-status-row.test.ts`

Только читать: `src/main/integrations/store.ts` (03), `src/main/integrations/auth/tokens.ts` (04),
`.scratch/worfy-integrations/spike-integrations.md` (01), `src/main/agent/fake-query.ts`, `docs/features/mcp-servers.md`,
`docs/adr/0021-mcp-servers-allowlist-in-profile.md`.

## Вне скоупа

- OAuth в `authProvider` — Ticket 05; Codex — 07; экран — 08; Sign in в chip-е, Autopilot, Health check — 09.
  `resources`, `prompts`, elicitation, sampling, MCP Apps — вне Epic-а, если записка 01 не показала нужды.

## Итог

Proxy — `src/main/integrations/proxy.ts`: `IntegrationProxy` держит одно соединение с сервисом на Integration и Machine
(`Client` пакета `@modelcontextprotocol/sdk` 1.32.0 — теперь прямая зависимость, в `pnpm-lock.yaml` одна копия — со
`StreamableHTTPClientTransport` или `StdioClientTransport`), общее для всех Session-ов. `sessionServer` — сервер одной
Session: `tools/list` сервиса один раз на старт, фильтр Project-а (`all`, `read-only` по `readOnlyHint`, список),
метка в начале описания, tool с полным именем длиннее 128 убран и назван в статусе; вызов отфильтрованного tool-а
отказывает до сервиса. 401, не сохранённый token и `UnauthorizedError` — ответ `isError` «Sign-in needed: <метка>. Ask
the user to sign in in worfy.» и статус `needs-sign-in`. Статус (`status(id)`): вход, `toolsCost` (число tools и длина
JSON имён, описаний и схем / 4), скрытые tools. Имя сервера — `integrationServerNames` (slug до 24 символов, `-2` при
совпадении). `McpTool` (`src/main/vendors/mcp.ts`) получил второй вид входа — `inputSchema`, `McpServer` — `listTools()`;
SDK-сервер Claude для такого сервера — низкоуровневый `Server` пакета (`src/main/vendors/claude/mcp.ts`). `sdkQueryFactory`
отдаёт включённые Integration-ы Project-а в `mcpServers` рядом с `worfy-canvas`; строки chip-а — источник `integration`
и метка (`mcpShownName` показывает метку).

Красный до правки: `pnpm test test/unit/integration-server-name.test.ts test/unit/mcp-status-row.test.ts
test/contract/integrations-proxy.test.ts test/contract/integrations-claude-session.test.ts` — exit 1 (4 файла: модуля
`proxy.ts` нет, `labelIntegrations` нет, источников четыре). После правки — exit 0 (51 test). Проверка PATH stdio-сервера
добавлена вместе с кодом, отдельного красного run-а у неё нет. Все unit и contract test-ы затронутых модулей (38 файлов)
— exit 0; `pnpm test:e2e test/e2e/session-mcp.spec.ts` под `/tmp/worfy-e2e.lock` — exit 0. `pnpm lint`, `pnpm typecheck`
— exit 0. Token: аргументы и окружение процесса, которые строит настоящий `query()` Agent SDK (spawn test-а ничего не
запускает), опции Session, строки `console` main и ответы tool-ов (их читает транскрипт, а из него Journal и Flight
recorder) — без token-а; Autopilot-ом Journal и Flight recorder отдельно не прогонялись.

Решено без владельца:
1. Метка — в начале описания tool-а («[Jira — client A] …»), не в конце: так она видна первой и не теряется, если
   описание длинное.
2. Tool с полным именем `mcp__<сервер>__<tool>` длиннее 128 proxy сам убирает из `tools/list` (Claude Code всё равно
   выбросил бы его молча) и называет в статусе (`hidden`) — экран Ticket-а 08 покажет «tool не виден агенту».
3. Slug: латиница без диакритики (NFKD); метка без латиницы и цифр — `integration`. Slug с префиксом `worfy-` получает
   `-2`, как велит Ticket (`worfy-canvas` → `worfy-canvas-2`): с суффиксом имя не совпадает ни с одним сервером worfy.
4. Отказ входа при первом `tools/list`, когда списка ещё не было, — `tools/list` падает с текстом «Sign-in needed: …»
   (Claude Code покажет сервер failed с этим текстом); если список Integration-ы уже был, Session получает его, а вызовы
   отвечают «Sign-in needed».
5. Соединение: другие секреты в хранилище (новый token) — новое соединение при следующем вызове; 404 (сервис забыл
   session) — переоткрыть один раз; прочий сбой — соединение закрывается, статус `error` с текстом без секретов; ошибка
   протокола от сервиса (JSON-RPC) соединение не закрывает.
6. Текстовые блоки и `structuredContent` успешного ответа тоже очищаются от секретов этой Integration-ы — на случай
   сервиса, который цитирует token.
7. Имена серверов Claude Code — `inventoryServerNames` в `mcp-inventory.ts` (реестр экземпляров `McpInventory`), без
   правки `session.ts`. Цена: первая Session после запуска worfy стартует раньше первого ответа инвентаря, и совпадение с
   сервером Claude Code тогда не видно.
8. Метки строк хранятся по query (`labelIntegrations`, `WeakMap` в `src/main/vendors/claude/mcp.ts`), без правки
   `session.ts` и `QueryRequest`; строки и `system/init`, и `mcpServerStatus()` получают их.
9. Stdio: stderr сервера не читается (может печатать то, с чем запущен); базовое окружение — короткий список пакета
   (HOME, PATH, USER…) с PATH окружения агента (login shell), а не всё окружение worfy.
10. Вызов tool-а ждёт до 10 минут; отмена агента доходит до сервиса.
11. Статус proxy живёт в памяти main (`IntegrationProxy.status`); каналом его покажет Ticket 08.
12. Вне «Где в коде», вынужденно: `src/renderer/session/McpChip.tsx` (подпись источника `worfy integration` — тип
    `Record<McpServerSource, …>` требует её), `src/main/mcp/http-server.ts` (одна строка — схема через `mcpInputSchema`,
    иначе `McpTool` с JSON Schema не собирается), новые stub-ы `test/fixtures/integrations/service-stub.ts` и
    `stdio-service-stub.mjs` (stub-ы Ticket-а 04 не перечисляют tools).
13. Blocker 01 открыт только для живого шага владельца; tools-only proxy подтверждён («Решено без владельца», 4 spec-а).
