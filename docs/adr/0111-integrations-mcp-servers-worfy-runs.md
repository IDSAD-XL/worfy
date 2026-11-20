# 0111 — Integrations — MCP-серверы, которые ведёт worfy
Дата: 2026-11-20. Статус: принят.

**Контекст.** Пользователю нужно несколько аккаунтов одного сервиса в одном Project-е: «Jira — client A» и «Jira — client
B». Connector claude.ai даёт один аккаунт на сервис, Claude Code различает два удалённых сервера на одном адресе только по
имени, а список `mcp.allowed` (ADR-0021) сверяет удалённый сервер по адресу — два аккаунта Jira он не различает. Вход в
удалённый сервер Claude Code держит у себя, и worfy видит его только через недокументированный `mcpAuthenticate`. Codex
серверов пользователя от worfy вообще не получает. Spec Epic-а `worfy-integrations` (`.scratch/worfy-integrations/spec.md`)
принят владельцем 2026-11-20 вместе с ответами Q1–Q10 и пятью пунктами «Решено без владельца». Этот ADR записывает
решение целиком; в коде на дату ADR есть модель, каталог, хранилище и каналы (Ticket 03), proxy, вход и экран — Ticket-ы
04–08.

**Решение.**

1. **Integration — сервер MCP, который ведёт worfy** (Q1). Integration — один подключённый аккаунт одного сервиса с меткой
   (термин — `CONTEXT.md`, Integration). Session получает её как `McpServer` worfy-proxy: worfy main держит соединение с
   сервисом (streamable HTTP или stdio-процесс, который запускает сам worfy), Session Claude получает SDK-сервер в процессе
   worfy, Session Codex — адрес на `127.0.0.1` с token-ом Session, тем же путём, что `worfy-canvas`. Token сервиса не
   попадает ни в аргументы процесса, ни в файлы Claude Code и Codex. Два аккаунта на одном адресе — два сервера с разными
   именами. Первая версия proxy передаёт только tools; `resources`, `prompts`, elicitation и sampling — если spike Ticket-а
   01 покажет нужду («Решено без владельца», 4).
2. **Integration принадлежит Machine и включается в Project** (Q2). Список Integration-ов Machine —
   `<WORFY_DATA_DIR>/integrations/integrations.json`, без секретов. Какие из них Project использует — поле `integrations` в
   `<Project data folder>/settings.json`: `{ id, enabled, tools, autopilot }` на запись, где `tools` — `all`, `read-only`
   или список имён. Integration, добавленная из Project-а, сразу включена в нём; другой Project той же Machine включает её
   галочкой, без второго входа. Метка уникальна на Machine (без учёта регистра и пробелов по краям). Remove Integration,
   включённой в другом Project-е, требует подтверждения; после него Integration уходит из всех Project-ов Machine.
3. **Секреты — файл 0600 в папке 0700 за `SecretStore`** (Q3). Token-ы, OAuth-клиент и секретные переменные stdio-сервера
   лежат в `<WORFY_DATA_DIR>/integrations/secrets.json` — `FileSecretStore` из `src/main/link/secrets.ts` со своим файлом,
   ключи `<id>:access`, `<id>:refresh`, `<id>:client`, `<id>:env:<NAME>`. Папка `integrations/` — 0700 с первой записи любого
   из двух файлов. Electron `safeStorage` не выбран по той же причине, что у связи (ADR-0052): ad-hoc подпись worfy меняется
   с каждой сборкой, и Keychain спрашивал бы доступ после каждого обновления; хранилище сменяется за интерфейсом
   `SecretStore` без правки остального. Remove удаляет сначала секреты, потом запись: прерванное удаление оставляет
   Integration без входа, но никогда секрет без Integration.
4. **Вход ведёт worfy** (Q3, Q4, Q5, Q10). Сначала token-ы (Bearer, Basic, свой заголовок, секреты stdio; Ticket 04), затем
   OAuth 2.1 с PKCE на `OAuthClientProvider` пакета `@modelcontextprotocol/sdk` в окне worfy с cookie partition
   `persist:integration-<id>` и регистрацией клиента через Dynamic Client Registration (Ticket 05). Где OAuth сервиса закрыт
   стороннему клиенту (GitHub), — только token.
5. **Каталог — данные** («Решено без владельца», 5). `src/shared/integrations/catalogue.ts`: адрес, способы входа, scope-ы,
   подсказка, где взять token, имя по умолчанию. Первая версия: Jira and Confluence (`https://mcp.atlassian.com/v2/mcp`),
   Linear, Notion, Sentry, GitHub (только token), Figma с пометкой «may refuse worfy» (принимает только клиентов своего
   каталога) и Custom server (http или stdio). Новый сервис — строка каталога, не код.
6. **Slack вне каталога** (Q6, ответ владельца 2026-11-20). Сервер Slack пускает только зарегистрированное приложение Slack с
   secret-ом, а workspace-ы клиентов владельца сторонних приложений не разрешают. Slack остаётся за connector-ом claude.ai и
   виден среди серверов Claude Code с нынешним Allow. Cookie token-ы браузера (`xoxc`, `xoxd`) worfy не использует никогда.
7. **Autopilot** (Q7). Session без человека получает только Integration-ы с `autopilot: true` в Project-е; набор
   фиксирован в начале Wave. Окно входа без человека не открывается никогда: отказ входа — ответ tool-а «Sign-in needed» и
   строка Health check.
8. **Linked machine** (ADR-0052, ADR-0066). Integration-ы живут на Machine Project-а. Каналы `integrations.list` и
   `integrations.status` — `project` `read`: их видит Linked machine с доступом только на чтение, секретов в ответах нет.
   `integrations.setEnabled`, `setTools`, `setAutopilot`, `rename` — `project` `write`, только полный доступ.
   `integrations.add`, `setSecret`, `remove` — `local`: Add integration, ввод token-а и удаление идут только на своей
   Machine, секрет по связи не идёт никогда («Решено без владельца», 3).
9. **worfy не пишет чужую конфигурацию.** Ни Profile, ни репозиторий Project-а, ни `~/.claude.json`, `.mcp.json`,
   `config.toml` Codex Integration-ы не трогают; Full mode и Silent mode одинаковы (ADR-0005).
10. **Отношение к ADR-0021** (Q9). Список `mcp.allowed` Profile-а остаётся для серверов Claude Code как есть. Integration-ы
    в нём не живут и policy tier их не трогает: Session Project-а получает их по полю `integrations` Project-а. Записи
    `mcp.allowed` в Integration-ы никогда не переносятся автоматически. Цену tools в каждом ходе (довод ADR-0021) держит
    фильтр tools Project-а: All по умолчанию, с числом и размером tools на виду и Read only одним щелчком («Решено без
    владельца», 2).

**Последствия.** Файл 0600 читает любой процесс того же пользователя — как `~/.claude/.credentials.json` Claude Code и
`link/secrets.json` worfy; это принято по правилу владельца о соразмерной защите. Пока worfy закрыт, tools Integration-ов
не работают: proxy живёт в main. Connector claude.ai и Integration одного сервиса в одной Session дают агенту два похожих
набора tools; раздел Integrations предупреждает об этом (Ticket 08). Статус Integration до proxy (Ticket 06) — только то,
что worfy знает без запроса к сервису: есть ли нужные секреты.

## Considered Options

- **Через Claude Code** (Q1 в): worfy пишет серверы с уникальными именами в `~/.claude.json` и входит `claude mcp login`.
  Отвергнуто: worfy писал бы конфигурацию пользователя (ADR-0005), а ключ, под которым Claude Code хранит token, не
  проверен; Codex так не покрыть.
- **Напрямую** (Q1 б): запись `http` с `Authorization: Bearer` в `mcpServers` Session, вход ведёт worfy. Отвергнуто: token
  виден в `ps`, refresh — только Restart-ом Session, склейка двух аккаунтов по адресу не проверена.
- **Integration принадлежит Project-у** (Q2 б), как Browser profile. Отвергнуто: второй Project того же клиента входит в тот
  же аккаунт заново.
- **Electron `safeStorage`** (Q3 б: Keychain на Mac, DPAPI на Windows). Отложено, пока подпись worfy не станет постоянной:
  с ad-hoc подписью Keychain спрашивает доступ после каждого обновления; тесты и CI `safeStorage` не имеют. Замена — новая
  реализация `SecretStore`.
- **Slack с internal app пользователя** (Q6 а) или своим приложением worfy в Marketplace (Q6 б). Отвергнуто владельцем:
  workspace-ы клиентов не разрешают сторонние приложения; своё приложение не планируется.
- **Перенести серверы каталога из `mcp.allowed` в Integration-ы при первом запуске** (Q9 б). Отвергнуто: у работающих
  Project-ов ничего не должно меняться само; перенос — действие «Add as integration» у строки сервера.
- **Integration через worfy-proxy, на Machine, включение по Project-у, секреты за `SecretStore`** (выбрано).
