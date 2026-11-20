# Как worfy может регулярно читать Slack, Jira, Gmail и Google Calendar: факты из первоисточников

- **Дата:** 2026-11-20. Все страницы прочитаны 2026-11-20. Если у страницы есть отметка «Last updated», она стоит рядом
  со ссылкой.
- **Тема** `proactive-runtime`, карта — [map.md](map.md). Вопрос —
  [issues/12-как-читать-внешние-источники.md](issues/12-как-читать-внешние-источники.md): как приложение на машине
  пользователя регулярно читает Slack, Jira, Gmail и Google Calendar.
- **Статус:** исследование, не решение и не юридическая консультация.
- **Как проверено.** Страницы скачаны как текст, цитаты сверены с этим текстом. Прежний текст changelog Slack сверен с
  копиями web.archive.org от 2025-06-01 и 2025-07-26. Запросов к API самих сервисов не было. Код worfy не читался.
  Расчёты нагрузки — мои, по цифрам из цитат; они помечены словом «расчёт».
- **Как читать.** Метка вида [S3] ведёт к цитате в списке «Цитаты» того же раздела. Цитаты дословные, на английском.
  Лишние пробелы, которые появились при снятии HTML-разметки, убраны.

## 1. Slack

«То, что касается меня» в Slack — упоминания, личные сообщения, ответы в тредах. Их видит user token пользователя.
Bot token видит только каналы, где bot участник [S5]. Проверка без модели — это один вызов `search.messages` или
проход по каналам через `conversations.history`. Push без публичного адреса даёт Socket Mode. Главное ограничение —
правило 2025 года для приложений, которые раздают вне Slack Marketplace (такие приложения Slack называет unlisted).

| Путь доступа | Token | Push без публичного адреса | Rate limit при polling раз в 10 мин / раз в час | Что нужно для раздачи | Источник |
|---|---|---|---|---|---|
| `search.messages`: поиск по запросу с модификаторами `from:`, `in:`, `after:` (дата с точностью до дня), сортировка по `timestamp` | Только user token, scope `search:read` | Нет, это polling | Tier 2, «20+ per minute». Одна проверка — один вызов, до 100 результатов на страницу. Хватает и для 10 мин, и для часа (расчёт). Метод помечен legacy | Правило 2025 года этот метод не затрагивает. Internal app пользователя — без ограничений. Marketplace — review | S1, S3, S4, S9 |
| `users.conversations`, затем `conversations.history` с `oldest` по каждому каналу | User token видит все публичные каналы и свои приватные; bot token — только каналы, где bot участник; scopes `*:history` | Нет | Internal app и Marketplace app: Tier 3, «50+ per minute», `limit` до 999. Новое unlisted app или новая установка после 2025-05-29: «1 request per minute», до 15 сообщений за запрос. При 50 каналах один проход занимает не меньше 50 минут: polling раз в 10 мин невозможен, раз в час — на пределе (расчёт) | Без урезания — только internal app пользователя или Marketplace app | S1, S2, S5, S6 |
| Events API через Socket Mode: события в каналах и личных сообщениях, которые видит установивший app пользователь | App-level token для WebSocket; события пользователя требуют его OAuth scopes | Да: WebSocket, публичный HTTP URL не нужен | До 30 000 доставок событий за 60 минут на workspace на app. До 10 WebSocket-соединений одновременно | Socket Mode app нельзя выставить в Marketplace. Остаются internal app пользователя или unlisted app | S7, S8 |
| Real-time Search API, метод `assistant.search.context` (фильтры `after`/`before` в UNIX time) | User token (без `action_token`) или bot token с `action_token`; scopes `search:read.*` | Нет | «10+ requests per minute» на команду и 10 в минуту на пользователя. Лимит «designed to support interactive user searches»; при постоянной нагрузке — дневные лимиты | Только Marketplace app или internal app. API Terms запрещают «background data collection ... unrelated to user queries» | S10, S11, S19 |
| Slack MCP server `https://mcp.slack.com/mcp` | User token через confidential OAuth (client_secret) или PKCE; app с фиксированным app ID | Нет | Те же rate limit, что у Web API, по каждому tool | Только Marketplace app или internal app; unlisted app запрещены. Admin workspace одобряет MCP client | S12, S13 |

### OAuth в desktop-приложении без сервера

- Обычный OAuth Slack требует redirect на HTTPS и client secret при обмене кода [S14]. Token-ы по умолчанию не
  истекают [S14].
- С 2026-03-30 PKCE доступен всем [S16]. После включения PKCE redirect на `localhost` и custom URI scheme считаются
  desktop redirect. Такой redirect не может просить bot scopes. Код обменивается без client_secret. Refresh token-ы
  живут 30 дней [S15, S16]. Включение PKCE нельзя отменить без support Slack [S15].

### Три способа раздать Slack app

- **Internal (undistributed) app** живёт в одном workspace [S17]. Если его создал сам клиент, правило 2025 года его не
  касается [S1, S2].
- **Unlisted distributed app** — по словам Slack, для пилота с первыми клиентами; review нет [S17]. Новые установки
  получают урезанные `conversations.history` и `conversations.replies` [S1]. Real-time Search API и MCP server ему
  закрыты [S11, S12].
- **Slack Marketplace** — бесплатный review с проверкой безопасности и scopes [S1]. Подать заявку можно при 10 и
  более активных workspace, и их должно оставаться не меньше 10 всё время review [S18]. Socket Mode в Marketplace не
  допускается [S7].
- **API Terms о коммерческой раздаче.** Коммерческая раздача разрешена только через Marketplace или отдельный
  partner agreement. Это касается и «custom Application or Application template» [S19]. Под «Commercially Distribute»
  Terms понимают в том числе «a free App that connects to a paid product or service». Ограничение не действует, если
  приложение и связанные продукты сделаны «for use only by a single third party» [S19].

### Цитаты

- **[S1]** https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps — запись от
  2025-05-29, позже исправлена (на странице: «This page has been updated to clarify the rate limits for existing
  internal customer-built apps.»), прочитано 2026-11-20:
  - «This rate limit reduction will apply only to applications that are commercially distributed outside of the
    Marketplace (also called “unlisted” apps). It will immediately impact affect new unlisted applications and new
    installations of existing unlisted non-Marketplace applications. The new rate limits will be updated to allow 1
    request per minute and will return a maximum of 15 objects per request.»
  - «The new rate limits will not be applied to existing installations of unlisted, distributed applications
    published outside the Marketplace.»
  - «Internal customer-built applications are not impacted by these changes. For Custom apps, the
    conversations.history and conversations.replies API methods are limited to 50+ requests per minute. The maximum
    and default values for the limit parameter are 1,000 objects.»
  - «If you don't call the conversations.history or conversations.replies Web API methods, you will likely not see
    any rate limit changes for the time being.»
  - «Commercial Distribution: The updated terms confirm that the Slack Marketplace is the only appropriate channel for
    commercially distributing apps built with Slack APIs, whether those apps are "unlisted" (published outside of the
    Marketplace) or provide a customer instructions for a templated custom app that connects to your product.»
  - «Slack does not charge for Marketplace inclusion, so it is open to developers who meet Marketplace guidelines and
    submit for review. While Slack does not certify or endorse apps, before an app can be published on the
    Marketplace, we perform a security review and analyze the scopes that an application requests in light of its
    functionality.»
  - «Unlisted apps, by contrast, are for development and testing—not large-scale or commercial distribution.»
- **[S1a]** Копия того же текста от 2025-06-01:
  http://web.archive.org/web/20250601032413/https://api.slack.com/changelog/2025-05-terms-rate-limit-update-and-faq —
  «Beginning September 2, 2025, existing installations and apps that are not Marketplace-approved will be subject to
  the new posted limits.» Копия от 2025-07-26 говорит то же, но исключает internal app, созданные до 2025-05-29.
  Текущая версия про существующие установки говорит обратное (цитата в [S1]). Для нового app worfy это не важно: все
  его установки будут новыми.
- **[S2]** https://docs.slack.dev/changelog/2025/06/03/rate-limits-clarity — 2025-06-03: «Any internal customer-built
  apps will maintain their existing rate limits and will not be subject to the new posted limits.»
- **[S3]** https://docs.slack.dev/reference/methods/search.messages: «Scopes User token: search:read»; «Rate Limits Tier
  2: 20+ per minute»; «This is a legacy method»; «We recommend using the Real-time Search API (assistant.search.context
  method) instead.»; «Return matches sorted by either score or timestamp.»; «Pass the number of results you want per
  "page". Maximum of 100.»; «When using a user token with this method, search results will be affected by the search
  filters set in the Slack UI.»
- **[S4]** https://slack.com/help/articles/202528808-Search-in-Slack: «Add before:, after:, or on: in front of a date,
  or during: in front of a month or year»
- **[S5]** https://docs.slack.dev/reference/methods/conversations.history: «Rate Limits Tier 3: 50+ per minute»;
  аргумент `oldest` — «Only messages after this Unix timestamp will be included in results.»; аргумент `limit` —
  «Maximum of 999.», «Default: 100». Таблица token-ов: «Bot token | Relevant \*:history scope | Any conversation the
  relevant bot is a member of.» и «User token | Relevant \*:history scope | Any private conversation the user is a
  member of, and all public conversations.» Об урезанном лимите для unlisted app на странице метода не сказано.
- **[S6]** https://docs.slack.dev/reference/methods/users.conversations: «Rate Limits Tier 3: 50+ per minute»
- **[S7]** https://docs.slack.dev/apis/events-api/using-socket-mode: «Socket Mode allows your app to use the Events API
  and interactive features—without exposing a public HTTP Request URL.»; «Apps using Socket Mode are not currently
  allowed in the public Slack Marketplace.»; «Your app-level token allows your app, either directly or with an SDK, to
  generate a WebSocket URL for communication with Slack via the apps.connections.open method.»; «Socket Mode allows
  your app to maintain up to 10 open WebSocket connections at the same time.»
- **[S8]** https://docs.slack.dev/apis/events-api/: «Workspace Events: these are the events that require a
  corresponding OAuth scope, and are perspectival to a member installing your application.»; «You will only receive
  events that users who have authorized your app can "see" on their workspace»; «Event deliveries currently max out at
  30,000 per workspace/team per app per 60 minutes.»
- **[S9]** https://docs.slack.dev/apis/web-api/rate-limits: «Broadly, you'll encounter limits like these, applied on a
  "per API method per workspace/team per app" basis.»
- **[S10]** https://docs.slack.dev/reference/methods/assistant.search.context: «This method is used to search messages
  across your Slack organization when used with an app using AI features.»; «For most teams, the limit is 10+ requests
  per minute while allowing for occasional bursts of more requests. For larger teams, this limit will be increased up
  to 400+ requests per minute with a generous burst. There's an additional user-level limit of 10 requests per minute
  with burst. This rate limit is specifically designed to support interactive user searches. Sustained usage at or
  above this rate will hit daily user limits and may result in rate limiting errors.»
- **[S11]** https://docs.slack.dev/apis/web-api/real-time-search-api: «No unlisted distributed apps allowed The RTS API
  is available for directory-published apps and internal apps only.»; «To use the Real-time Search API to fetch
  private conversation data or to use it outside the Slack client, a user token is required.»; «All API calls made
  using a bot token require an action_token. API calls made using a user token do not require an action_token.»; «You
  must not store or copy any of the data retrieved from this API. You may not use any of this data for training. You
  may not use this API to scrape data in a workspace that is unrelated to user queries.»
- **[S12]** https://docs.slack.dev/ai/slack-mcp-server/ (адрес `/ai/mcp-server/` ведёт сюда же):
  «https://mcp.slack.com/mcp»; «We do not support SSE-based connections or Dynamic Client Registration at this time.»;
  «MCP clients must be backed by a registered Slack app with a fixed app ID and hardcode that app ID.»; «Only apps
  published in the Slack Marketplace and internal apps can use MCP at this time; unlisted apps are prohibited from
  using MCP.»; «Slack supports confidential OAuth for MCP clients. You'll need to use your app's client_id and
  client_secret for Slack OAuth.»; «Looking to use desktop clients? PKCE support is now available!»; «Like all Slack
  Web API methods, the Slack MCP server is subject to rate limits. Limits are enforced per tool or action type.»; в
  таблице tools: «Search messages & files Special rate limits apply; consult method page documentation» и «Read a
  channel Tier 3: 50+ per minute»; «Workspace admins can approve and manage all MCP client integrations, keeping your
  Slack data safe.»
- **[S13]** https://docs.slack.dev/changelog/2026/02/17/slack-mcp — 2026-02-17: «Unlike APIs, the MCP server is built
  specifically for LLM consumption with robust descriptions and examples that return natural language responses.»;
  «The Data Access API has evolved into the Real-time Search API!»
- **[S14]** https://docs.slack.dev/authentication/installing-with-oauth: «The redirect_uri must use HTTPS.»; «A Redirect
  URL must also use HTTPS.»; «You have to prove both that you have the right temporary authorization code, and that
  you have your app's client secret.»; «OAuth tokens do not expire.»; «If you have specific need for a user token (for
  example, so that you can act on behalf of a user), provide a user_scope parameter with requested user scopes instead
  of, or in addition to, the scope parameter.»
- **[S15]** https://docs.slack.dev/authentication/using-pkce: «Enabling PKCE marks your app as a public client, which is
  is a one-way operation. It cannot be disabled without contacting Slack support.»; «Redirects to localhost (e.g.
  http://localhost:8080/auth) are treated as desktop redirects if the app has opted into PKCE.»; «Desktop redirects are
  not allowed to request bot scopes.»; «The client should call the oauth.v2.access API method, but should not include
  client_secret in the parameters.»; «Note that if PKCE is enabled, all refresh tokens issued to your app will expire
  in 30 days instead of lasting indefinitely.»
- **[S16]** https://docs.slack.dev/changelog/2026/03/30/pkce — 2026-03-30: «PKCE is now generally available!»; «All
  refresh tokens issued to PKCE-enabled apps expire after 30 days.»
- **[S17]** https://docs.slack.dev/app-management/distribution/: «Undistributed apps exist on a single workspace and
  can use the full range of app capabilities, but they can't be distributed to other workspaces.»; «Distributing your
  unlisted app is perfect for when you want to test out your app by running a pilot for early customers; however, apps
  intended for commercial distribution should be submitted and approved for listing in the Slack Marketplace.»;
  «Workspaces can also enable admin approval requirements so that users can't directly install apps, but can request
  installation via a guided interface.»; «Slack apps open to installation by other workspaces have additional security
  requirements. Your app must support SSL for all of the following URLs:»
- **[S18]** https://docs.slack.dev/changelog/2026/09/01/slack-marketplace-install-requirement — 2026-09-01: «As of July
  2026, we require that apps submitting to the Slack Marketplace have at least 10 installations on active workspaces,
  up from the temporary lower threshold. Your app needs to stay at 10 or more installed workspaces throughout the
  entire duration of the review.» И https://docs.slack.dev/changelog/2026/11/02/slack-marketplace-submission-criteria
  — 2026-11-02: «Slack Marketplace submissions that meet the low-usage criteria will not be reviewed.» (low-usage — это
  меньше 10 активных workspace и меньше 20 активных пользователей в месяц).
- **[S19]** https://slack.com/terms-of-service/api, «Effective: October 10, 2025»:
  - «By “Commercially Distribute” we mean any situation where your Application integrates with Slack APIs and users
    could pay fees for your product, service, or features—whether it's a direct charge to access the App, a
    'freemium' model where some features are gated, or a free App that connects to a paid product or service.»
  - «The restrictions in this section apply to all Applications that are Commercially Distributed, regardless of
    whether you publish an off-the-shelf Application or you provide customers with a custom Application or Application
    template that connects to other products, services, or features. These restrictions do not apply if your
    Application and any products or services connected to it were created for use only by a single third party.»
  - «If you offer your Application for use by others outside your organization, you must obtain explicit authorization
    from the organization installing your Application for the use, processing, and storage of API Data.»
  - «As the provider of an Application offered for use outside your organization, you may not: (A) use API Data to
    train a large language model; (B) bulk export Slack message and file data except where expressly allowed by an
    additional agreement ...»
  - «Your Application’s use of these APIs should be transparent to and reasonably expected by users of the Services;
    background data collection or scraping for data unrelated to user queries is prohibited. When using these APIs as a
    third-party Application provider, you may not create persistent copies, archives, indexes, or long-term data stores
    of other organizations’ API Data.» (раздел «Data Access API and Real-Time Search API»)
- **[S20]** https://docs.slack.dev/changelog/2025/10/13/api-terms-update — 2025-10-13: «The “Distribution Beyond Your
  Organization” section has always only applied to applications distributed beyond your organization (i.e.,
  third-party apps, not custom internal ones), but we added more language throughout emphasizing that.»

## 2. Jira Cloud

«То, что касается меня» в Jira — задачи, где пользователь исполнитель (assignee), автор (reporter), наблюдатель
(watcher) или упомянут. Это выражается языком запросов JQL. Push бывает только webhook-ом на HTTPS URL. Для
desktop-приложения без сервера самый простой документированный путь — personal API token.

Пример запроса для проверки раз в час (составлен мной из документированных полей; поиск упоминаний взят из статьи
Atlassian Community, а не из документации):
`(assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser() OR comment ~ currentUser()) AND updated >= "-1h"`

| Путь доступа | Token | Push без публичного адреса | Rate limit при polling раз в 10 мин / раз в час | Что нужно для раздачи | Источник |
|---|---|---|---|---|---|
| `GET` или `POST /rest/api/3/search/jql` с JQL. Старый `/rest/api/3/search` помечен «Currently being removed». Свежие изменения могут появиться в поиске с задержкой | Personal API token через HTTP basic (email и token). Token с scopes — через `https://api.atlassian.com/ex/jira/{cloudId}` | Нет | Трафик API token не входит в новую points-квоту. Действуют только burst limits: по умолчанию 100 GET-запросов в секунду на endpoint на tenant. Одна проверка — один запрос плюс страницы; и раз в 10 мин, и раз в час это ничтожная доля лимита (расчёт) | Каждый пользователь сам создаёт token. Срок — от 1 дня до 1 года. Admin с Atlassian Guard Standard может запретить token-ы внешним пользователям | J1, J2, J3, J4, J5, J6 |
| Тот же поиск через OAuth 2.0 (3LO) app | Access token 3LO, запросы через `api.atlassian.com`. При обмене кода нужен client_secret; PKCE на странице 3LO не упомянут. Refresh token rotating, истекает после 90 дней без активности | Нет | Points: 1 за запрос и по 1 за каждую задачу в ответе. Квота по умолчанию — 65 000 points в час на всё приложение, общая для всех tenant-ов. Пример (расчёт): ответ из 20 задач ≈ 21 point; при polling раз в час квоты хватит примерно на 3 000 пользователей worfy, раз в 10 мин — примерно на 500. При исчерпании все запросы отклоняются до начала следующего часа | Включить sharing и раздавать ссылку. Без review Atlassian пользователь видит предупреждение. Если worfy хранит personal data — отчёт в Personal data reporting API каждые 7 дней | J4, J7, J9 |
| Webhook, зарегистрированный OAuth 2.0 app через REST API | Access token 3LO | Нет: «Only secure HTTPS URLs are allowed» | До 5 webhook на app на пользователя на tenant. Webhook живёт 30 дней, потом его надо продлевать | Свой публичный HTTPS-сервер | J8 |
| Atlassian Rovo MCP server `https://mcp.atlassian.com/v2/mcp`, tool `searchJiraIssuesUsingJql` | OAuth 2.1 или API token (только если admin организации включил) | Нет | Официальных часовых цифр не нашёл. Часть tools тратит Rovo credits; с 2026-12-03 credits сверх включённых — pay-as-you-go. Запрос по одному продукту, например чтение задачи Jira, бесплатный | Работает с любым MCP client. Admin управляет списком доменов AI-инструментов | J10–J15 |

### Цитаты

- **[J1]** https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/: «Searches for issues
  using JQL. Recent updates might not be immediately visible in the returned search results. If you need
  read-after-write consistency, you can utilize the reconcileIssues parameter to ensure stronger consistency
  assurances.»; для `GET /rest/api/3/search` — «Currently being removed. Search for issues using JQL (GET)» и «Endpoint
  is currently being removed.»; «OAuth 2.0 scopes required: Classic RECOMMENDED: read:jira-work».
- **[J2]** https://support.atlassian.com/jira-software-cloud/docs/jql-fields/: «Search for work items that a particular
  user is watching.»; «watcher = currentUser()»; про `updated`: «Or use "w" (weeks), "d" (days), "h" (hours) or "m"
  (minutes) to specify a date relative to the current time. The default is "m" (minutes). Be sure to use quote-marks
  (");»
- **[J3]** https://community.atlassian.com/forums/discussion/2771763/how-to-search-for-your-mentions-with-jql — статья
  Atlassian Community, не документация: «You can search for comments that mention you with the JQL query: comment ~
  currentUser()»; «Under the hood, the plaintext of a mention is represented in the wiki-style format [~accountid:abc123],
  where abc123 represents the user’s Atlassian account ID (often shortened to AAID).»
- **[J4]** https://developer.atlassian.com/cloud/jira/platform/rate-limiting/ (Last updated Nov 20, 2026):
  - «Enforcement of the new points-based API rate limits and tiered quota rate limits for Jira and Confluence Cloud
    apps will begin on March 2, 2026»
  - «The new rate limits will apply to all Forge, Connect, and OAuth 2.0 (3LO) apps. ... API token-based traffic is not
    affected by this change, and will continue to be governed by existing burst rate limits.»
  - «Each request starts with a base cost of 1 point, and additional points are added for each object involved.»;
    строка таблицы: «Core domain objects (GET, GraphQL query) 1 point ... Issues, Projects, Dashboards, Attachments»
  - «Your app shares a single 65,000 point hourly quota across all tenants. This is the default tier for all apps.»
  - «All requests are denied until the next hourly reset. There is no gradual throttling.»
  - «The values below show the default steady state requests per second (RPS) limits for the given API based on its
    HTTP method.» — в таблице «GET | 100».
- **[J5]** https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/: «A
  primary use case for API tokens is to allow scripts to access REST APIs for Atlassian cloud apps using HTTP basic
  authentication.»; «After December 15, 2024, we set new API tokens to expire in one year by default. When you create
  an API token, you can set the expiration date to be from one day up to one year.»; «You need to call the Atlassian
  API to use API tokens with scopes for Jira» (дальше на странице — адрес `https://api.atlassian.com/ex/jira/{cloudId}`).
- **[J6]** https://support.atlassian.com/security-and-access-policies/docs/set-api-token-access/ (план «Atlassian Guard
  Standard»): «When you block user API token access for external users, they are unable to use a token to access apps
  through an app API, even if they previously used a token to access them.»; «It’s not possible for anyone else to
  create an API token on behalf of a user. Users must create API tokens themselves.»
- **[J7]** https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/ (Last updated Nov 20, 2026): «When you
  create an OAuth 2.0 (3LO) app, it's private by default. This means that only you can install and use it. If you want
  to distribute your app to other users, you must enable sharing.»; «Users trying to install an unapproved OAuth 2.0
  integration are warned that the app has not yet been reviewed by Atlassian.»; «client_secret: (required) Set this to
  the Secret for your app.»; «A rotating refresh token expires if the user is inactive for this period. Each new
  rotating refresh token resets the inactivty expiry time and allocates another 90 days.»; «Although OAuth 2.0 (3LO)
  apps can be listed on the Atlassian Marketplace, they will appear as informational listings only, with limited
  Marketplace features.»; «Set this to any URL that is accessible by the app.» (про Callback URL).
- **[J8]** https://developer.atlassian.com/cloud/jira/platform/webhooks/: «A webhook is a user-defined callback over
  HTTPS.»; «Only secure HTTPS URLs are allowed.»; «For an OAuth 2.0 app, the limit is 5 webhooks per app per user on a
  tenant.»; «The expiration period is 30 days from the time the webhook was created or refreshed using the Extend
  webhook life REST resource.»
- **[J9]** https://developer.atlassian.com/cloud/jira/platform/user-privacy-developer-guide/: «In order to comply with
  these requirements, we recommend that your apps do not store any user personal data and always retrieve current user
  data at the time of use using Atlassian APIs.»; «All apps storing personal data must report user personal data, using
  the Personal data reporting API.»; «By default, the cycle period is every 7 days.»
- **[J10]** https://developer.atlassian.com/cloud/rovo-mcp/ (Last updated Sep 2, 2026): «The Atlassian Rovo MCP Server
  is a cloud-hosted Model Context Protocol (MCP) server that connects AI-powered clients to your Atlassian Cloud
  apps.»; «An AI client connects to the server endpoint at https://mcp.atlassian.com/v2/mcp.»; «The server works with
  any MCP-compatible client, including:»; «Some tools consume Rovo credits.» И
  https://developer.atlassian.com/cloud/rovo-mcp/guides/supported-tools/ (Last updated Nov 2, 2026):
  «searchJiraIssuesUsingJql (Primary) | Search work items using JQL.»; «Deferred tools are found at runtime through the
  discover tool, which takes a natural-language description of what you want to do, and are then invoked with
  executeRead, executeWrite, or executeDestructive depending on the operation's risk tier.»
- **[J11]** https://developer.atlassian.com/cloud/rovo-mcp/guides/authentication-and-authorization/ (Last updated Sep
  2, 2026): «In addition, if enabled by your organization admin, the server supports authentication via API token for
  machine-to-machine and other non-interactive scenarios - for example, backend services, CI/CD pipelines, bots, and
  automated agents.»; «Regardless of the method, every action respects the authenticated user's existing access
  controls and permissions.»; «If your organization admin has disabled authentication via API token, MCP clients won't
  be able to connect using a token and will need to use OAuth 2.1 instead.»
- **[J12]** https://support.atlassian.com/rovo/docs/rovo-usage-limits/: «Context: Rovo credits are consumed when
  enriched context is returned from Teamwork Graph via TWG API and tool calls, such as when using tools like Claude or
  ChatGPT with the Teamwork Graph CLI or Atlassian Rovo MCP server.»; в строке «Free» таблицы: «Requesting single
  product context, such as looking up a Jira work item or Confluence page’s content.»; «On December 3, 2026,
  pay-as-you-go billing takes effect for Rovo credits.»
- **[J13]** https://support.atlassian.com/security-and-access-policies/docs/understand-atlassian-rovo-mcp-server/:
  «Domain settings (in Atlassian MCP server settings) control which AI tools and domains are allowed to connect when
  tools use OAuth 2.1.»; «By default, we automatically allow the Atlassian-supported domains that enable OAuth
  connections between AI tools and the Atlassian apps in your organization.»
- **[J14]** https://github.com/atlassian/atlassian-mcp-server (README): «After 30 June 2026, the legacy Server-Sent
  Events endpoint (https://mcp.atlassian.com/v1/sse) will no longer be supported.»
- **[J15]** https://github.com/atlassian/atlassian-mcp-server/issues/171 — вопрос пользователя, не ответ Atlassian:
  «The public docs don't publish hard numbers for MCP calls.» Я тоже не нашёл часовых лимитов Rovo MCP server на
  страницах Atlassian.
- **[J16]** https://developer.atlassian.com/platform/marketplace/atlassian-developer-terms/ («Effective starting:
  December 1, 2025»): по словам train, machine learning, artificial intelligence, AI model, large language в тексте
  ничего не найдено.

## 3. Gmail

«То, что касается меня» в Gmail — новые письма. Документированный способ дочитывать изменения — `users.history.list`
от сохранённого `historyId`. Все scopes, которые читают письма, у Google restricted. Это определяет, во что обходится
раздача.

| Путь доступа | Token | Push без публичного адреса | Rate limit при polling раз в 10 мин / раз в час | Что нужно для раздачи | Источник |
|---|---|---|---|---|---|
| `users.history.list` от `startHistoryId`, затем `users.messages.get` по новым письмам. При 404 — полная синхронизация | OAuth user token. Для desktop — loopback redirect `http://127.0.0.1:port` и PKCE. Scope `gmail.readonly` (restricted) или `gmail.metadata` (restricted, без тела письма) | Только через Cloud Pub/Sub: `users.watch` публикует в topic, приложение забирает сообщения pull-подпиской без публичного URL. `watch` нужно повторять не реже раза в 7 дней | `history.list` — 2 quota units, `messages.get` — 20 (60 для формата `full`). Лимит — 6 000 units в минуту на пользователя на проект и 1 200 000 в минуту на проект; выше 80 000 000 в сутки на проект Google планирует брать плату. Проверка с 10 новыми письмами в `full` ≈ 602 units — около 10 % минутного лимита пользователя (расчёт) | Свой client worfy для всех: restricted scope verification и ежегодная security assessment, если данные идут «from or through a third-party server». Без проверки — экран unverified app и не больше 100 новых пользователей. Альтернатива — Personal mode: каждый пользователь создаёт свой client, проверка не нужна | G1–G13 |
| `users.messages.list` с `q` в синтаксисе поиска Gmail | Как выше. `q` не работает со scope `gmail.metadata` | Как выше | `messages.list` — 5 units | Как выше | G3, G5 |
| Gmail MCP server `https://gmailmcp.googleapis.com/mcp/v1`: tools `search_threads`, `get_message`, `get_thread` и другие | OAuth client с отметкой «Use this client for an AI-powered agent» | Нет | Отдельных лимитов для MCP не нашёл | Developer Preview: нужно членство в Google Workspace Developer Preview Program | G14–G18 |
| Connector Gmail в claude.ai | OAuth Google внутри claude.ai | Нет | — | Работает только внутри Claude и Claude Code, то есть через модель | A1–A3 |

### Цитаты

- **[G1]** https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list (Last updated
  2026-04-15): «History IDs increase chronologically but are not contiguous with random gaps in between valid IDs.
  Supplying an invalid or out of date startHistoryId typically returns an HTTP 404 error code. A historyId is
  typically valid for at least a week, but in some rare circumstances may be valid for only a few hours. If you receive
  an HTTP 404 error response, your application should perform a full sync.»
- **[G2]** https://developers.google.com/workspace/gmail/api/guides/sync (Last updated 2026-09-15): «If the
  startHistoryId supplied by your client is outside the available range of history records, the Gmail API returns an
  HTTP 404 error response. In this case, your client must perform a full sync.»
- **[G3]** https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list: «Only return
  messages matching the specified query. Supports the same query format as the Gmail search box. ... Parameter cannot
  be used when accessing the api using the gmail.metadata scope.»
- **[G4]** https://developers.google.com/workspace/gmail/api/guides/push (Last updated 2026-09-15): «Configure the
  subscription type to be either a webhook push (that is, an HTTP POST callback) or a pull (that is, initiated by your
  app).»; «You must call the watch method at least once every 7 days or you'll stop receiving updates for the user. We
  recommend calling watch once per day.»; «Each Gmail user being watched has a maximum notification rate of one event
  per second.»
- **[G5]** https://developers.google.com/workspace/gmail/api/reference/quota (Last updated 2026-10-16):
  - «As of May 1, 2026, the usage limits for this API were updated. Google Cloud projects that made any use of this API
    between November 2025 and April 2026 will continue with their previously set usage quotas. Cloud projects created
    on or after May 1, 2026 are subject to the new API quotas.»
  - Таблица: «Per minute per project | 1,200,000 quota units»; «Per minute per user per project | 6,000 quota units»;
    «Per day per project | 80,000,000 quota units».
  - «This per day per project limit defines the maximum number of quota units your Google Cloud project can use within
    a 24-hour period before charges apply.»
  - Стоимость методов: «history.list | 2»; «messages.get | 20 (60 when format is full, raw, or html)»; «messages.list |
    5»; «watch | 100».
  - «All standard use of the Gmail API is available at no additional cost. Exceeding the quota request limits is
    planned to incur charges to your Google Cloud billing account later in 2026.»
- **[G6]** https://developers.google.com/workspace/gmail/api/auth/scopes (Last updated 2026-09-10): в таблице
  «Restricted scopes» — «https://www.googleapis.com/auth/gmail.readonly | View your email messages and settings.» и
  «https://www.googleapis.com/auth/gmail.metadata | View your email message metadata such as labels and headers, but not
  the email body.»; «If you store restricted scope data on servers (or transmit), then you must go through a security
  assessment.»
- **[G7]** https://developers.google.com/identity/protocols/oauth2/native-app (Last updated 2026-11-19): «Because these
  apps are distributed to individual devices, it is assumed that these apps cannot keep secrets (they are public
  clients). They can access Google APIs while the user is actively interacting with the app or when the app is running
  in the background.»; «Desktop apps are public clients and cannot keep secrets confidential. Always use PKCE (Proof
  Key for Code Exchange) when requesting authorization codes.»; «http://127.0.0.1:port or http://[::1]:port Query your
  platform for the relevant loopback IP address and start an HTTP listener on a random available port.»
- **[G8]** https://developers.google.com/identity/protocols/oauth2 (Last updated 2026-11-19): «A Google Cloud Platform
  project with an OAuth consent screen configured for an external user type and a publishing status of "Testing" is
  issued a refresh token expiring in 7 days, unless the only OAuth scopes requested are a subset of name, email
  address, and user profile»
- **[G9]** https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
  (Last updated 2026-11-10):
  - «Apps accessing restricted data from or through a third-party server must undergo an annual security assessment by
    a Google-approved third party.»
  - «Exceptions to verification requirements include personal use, development/testing/staging environments,
    service-owned data only, internal use within an organization, and domain-wide installation.»
  - «If your app requests any restricted scopes and doesn't qualify for an exception, you need to satisfy the
    Additional requirements for specific API scopes of the Google API Services User Data Policy»
  - «For this reason, the restricted scopes verification process can potentially take several weeks to complete.»
  - «Every app that requests access to Google users' restricted data and has the ability to access data from or through
    a third-party server must go through a security assessment from Google-empanelled security assessors.»
  - «Personal use: One use case is if you are the only user of your app or if your app is used by only a few users, all
    of whom are known personally to you.»
- **[G10]** https://support.google.com/cloud/answer/13465431 (Security Assessment): «applications requesting access to
  restricted scopes must undergo an annual security assessment.»; «Annual Recertification: All applications must be
  revalidated every year.» О цене оценки на странице не сказано.
- **[G11]** https://support.google.com/cloud/answer/15549945 (Manage App Audience): «Personal Projects configured with a
  user type of Personal limit authorization requests exclusively to the single Google Account that created the
  application.»; «Personal mode apps do not require OAuth app verification, are not subject to the OAuth user cap or
  7-day test user token expiration, and do not display the unverified app screen. If your account belongs to a Google
  Workspace organization, user authorization of scopes associated with restricted Google Workspace services might still
  require configuration by your organization's administrators»; «Personal mode is a one-time selection when configuring
  a new application»
- **[G12]** https://support.google.com/cloud/answer/7454865 (Unverified apps): «If your app remains unverified, the
  unverified app screen will be displayed before the consent screen, and your app will be limited to 100 new users
  until it is verified.»; «Personal mode apps: If you are the only user of your app and you create your app using the
  Personal mode onboarding page, your app is restricted exclusively to your Google Account, does not display the
  unverified app screen, and does not need to go through verification.»
- **[G13]** https://developers.google.com/workspace/tools-safety (Last updated 2026-09-03): «As of May 1, 2026, we are
  adjusting usage quotas across several Google Workspace product APIs, starting with Gmail API, Google Calendar API, and
  Google Drive API.»; «Later in 2026, following 90 days of notice: Quota increase requests will require Google Cloud
  billing to be enabled. API usage over standard daily thresholds will generate charges on your Google Cloud bill.»
- **[G14]** https://developers.google.com/workspace/gmail/api/reference/mcp (Last updated 2026-07-21): «Developer
  Preview: Available as part of the Google Workspace Developer Preview Program, which grants early access to certain
  features.»; «This is an MCP server provided by Gmail API. The server provides tools for developers to build LLM
  applications on top of Gmail.»; «https://gmailmcp.googleapis.com/mcp/v1»; список tools: «create_draft get_message
  get_thread label_message label_thread list_drafts list_labels search_threads unlabel_message unlabel_thread».
- **[G15]** https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server (Last updated 2026-11-19):
  «User-delegated OAuth 2.0 client IDs that call the Gmail MCP server must have Use this client for an AI-powered agent
  selected in Google Auth Platform > Clients.»; «If you can't change this setting on an existing client, or if the
  client also supports non-agent features, create a new OAuth 2.0 client ID for your AI agent.»
- **[G16]** https://developers.google.com/workspace/guides/configure-mcp-servers (Last updated 2026-11-19): «Google
  Workspace offers remote Model Context Protocol (MCP) servers that allow AI agents to securely interact with Google
  Workspace data.»; «Use Personal mode onboarding in the Google Cloud console to create an OAuth 2.0 client that works
  only for your Google Account and doesn't require app verification or separate OAuth consent screen setup»; «If your
  MCP client uses a desktop or mobile OAuth flow instead of a web redirect URI, open personal mode setup for a Desktop
  app, Android, or iOS client»
- **[G17]** https://workspaceupdates.googleblog.com/2026/05/agent-tools-and-security-updates-for-workspace-developers.html
  — 2026-05-01: «Today, we are opening the Workspace MCP server to public developer preview.»; «Gmail MCP: Profile
  access, drafting, searching, and read/write capabilities.»; «Calendar MCP: Finding available times and managing
  events.»
- **[G18]** https://developers.google.com/workspace/guides/configure-mcp-security (Last updated 2026-11-10): «You must
  screen prompts and responses for malicious content or prompt injection attacks. You can use the Google-provided Model
  Armor, or you can use your own solution if you document it in order for users to accept that risk.»

## 4. Google Calendar

«То, что касается меня» в календаре — новые и изменённые события. Документированный способ — инкрементальная
синхронизация через `syncToken`. Push только на HTTPS-адрес с настоящим сертификатом. Чтение событий — sensitive
scope, не restricted: проверка приложения нужна, security assessment — нет.

| Путь доступа | Token | Push без публичного адреса | Rate limit при polling раз в 10 мин / раз в час | Что нужно для раздачи | Источник |
|---|---|---|---|---|---|
| `events.list` с `syncToken` из прошлого ответа (`nextSyncToken`). На 410 — стереть локальные данные и синхронизировать заново | OAuth user token (desktop — loopback и PKCE, как у Gmail). Scope `calendar.events.readonly` или `calendar.readonly` | Нет: `events.watch` шлёт уведомления только на HTTPS с действительным SSL-сертификатом, self-signed не подходит | 600 запросов в минуту на пользователя на проект, 10 000 в минуту на проект; выше 1 000 000 запросов в сутки на проект Google планирует брать плату. Одна проверка — один запрос на календарь (расчёт) | Свой client worfy: sensitive scope verification — обоснование каждого scope, видео, privacy policy на домене приложения. Если тот же client просит и `gmail.readonly`, действуют требования для restricted scopes. Альтернатива — Personal mode | C1–C5, G7, G9, G11 |
| Calendar MCP server `https://calendarmcp.googleapis.com/mcp/v1`: tools `list_events`, `search_events`, `get_event` и другие | OAuth client «AI-powered agent» | Нет | Отдельных лимитов для MCP не нашёл | Developer Preview | C6, G16, G17 |
| Connector Google Calendar в claude.ai | OAuth Google внутри claude.ai | Нет | — | Только через модель в Claude и Claude Code | A1, A2 |

### Цитаты

- **[C1]** https://developers.google.com/workspace/calendar/api/guides/sync (Last updated 2026-11-07): «Incremental sync
  is performed repeatedly and updates the client with all the changes that happened ever since the previous sync. Each
  time, the client provides the previous sync token it obtained from the server and stores the new sync token from the
  response.»; «Sometimes sync tokens are invalidated by the server, for various reasons including token expiration or
  changes in related ACLs. In such cases, the server will respond to an incremental request with a response code 410.
  This should trigger a full wipe of the client’s store and a new full sync.»
- **[C2]** https://developers.google.com/workspace/calendar/api/guides/push (Last updated 2026-09-11): «An address
  property string set to the URL that listens and responds to notifications for this notification channel. This is your
  webhook callback URL, and it must use HTTPS.»; «Note that the Google Calendar API is able to send notifications to
  this HTTPS address only if there's a valid SSL certificate installed on your web server. Invalid certificates
  include: Self-signed certificates.»
- **[C3]** https://developers.google.com/workspace/calendar/api/guides/quota (Last updated 2026-11-11): «As of May 1,
  2026, the usage limits for this API were updated.»; «Per minute per project | 10,000 requests»; «Per minute per user
  per project | 600 requests»; «Per day per project | 1,000,000 requests»; «This per day per project limit defines the
  maximum number of requests your Google Cloud project can use within a 24-hour period before charges apply.»
- **[C4]** https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
  (Last updated 2026-11-10): «Examples of sensitive scopes include reading events stored in Google Calendar, storing a
  new contact in Google Contacts, or deleting a YouTube video.»; «Submitting your app for verification involves
  confirming policy compliance, keeping contact information current, using the Cloud Console Verification Center,
  declaring all scopes, and providing detailed justification and a video demonstration for sensitive scopes.»; «The
  privacy policy must be visible to users, hosted within the same domain as your application's home page, and linked
  to on the OAuth consent screen of the Google API Console.»
- **[C5]** https://developers.google.com/workspace/calendar/api/auth (Last updated 2026-09-03):
  «https://www.googleapis.com/auth/calendar.events.readonly | View events on all your calendars.»;
  «https://www.googleapis.com/auth/calendar.readonly | See and download any calendar you can access using your
  Calendar.»
- **[C6]** https://developers.google.com/workspace/calendar/api/v3/reference/mcp (Last updated 2026-11-16): «Developer
  Preview: Available as part of the Google Workspace Developer Preview Program»; «https://calendarmcp.googleapis.com/mcp/v1»;
  список tools: «create_event delete_event get_event list_calendars list_events respond_to_event search_events
  suggest_time update_event».

## 5. Для сравнения: GitHub notifications и Linear

| Путь доступа | Token | Push без публичного адреса | Rate limit при polling раз в 10 мин / раз в час | Что нужно для раздачи | Источник |
|---|---|---|---|---|---|
| GitHub `GET /notifications` с `If-Modified-Since`; `participating=true` — только где пользователь участник или упомянут | Только personal access token (classic). Fine-grained token и token-ы GitHub App не работают | Нет (polling) | Ответ 304 не тратит лимит. Заголовок `X-Poll-Interval` задаёт минимальный интервал (в примере 60 с). Общий лимит — 5 000 запросов в час. Раз в 10 мин — 6 запросов в час (расчёт) | Каждый пользователь создаёт свой token | H1, H2 |
| Linear GraphQL, запрос `notifications` | Personal API key или OAuth app; OAuth поддерживает PKCE | Нет: webhook только на публичный HTTPS, не localhost | API key — 2 500 запросов в час на пользователя; OAuth app — 5 000. Linear прямо не одобряет polling | API key пользователя или OAuth app с PKCE | L1–L5 |

### Цитаты

- **[H1]** https://docs.github.com/en/rest/activity/notifications: «These endpoints only support authentication using a
  personal access token (classic).»; «Notifications are optimized for polling with the Last-Modified header. If there
  are no new notifications, you will see a 304 Not Modified response, leaving your current rate limit untouched. There
  is an X-Poll-Interval header that specifies how often (in seconds) you are allowed to poll.»; «This endpoint does not
  work with GitHub App user access tokens, GitHub App installation access tokens, or fine-grained personal access
  tokens.»; «participating boolean If true, only shows notifications in which the user is directly participating or
  mentioned.»
- **[H2]** https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api: «All of these requests count
  towards your personal rate limit of 5,000 requests per hour.»
- **[L1]** https://linear.app/developers/rate-limiting: «When authenticated using an API key you can make up to 2,500
  requests per hour.»; в таблице: «OAuth App | 5,000»; «One thing that we especially discourage is polling the API to
  fetch updates. If you need to know when data updates in Linear, you should use our Webhook functionality.»
- **[L2]** https://linear.app/developers/oauth-2-0-authentication: «Linear supports the PKCE flow.»
- **[L3]** https://linear.app/developers/webhooks: «It’s available in a publicly accessible HTTPS, non-localhost URL»
- **[L4]** https://linear.app/docs/mcp: «The interactive setup flow uses OAuth 2.1 with dynamic client registration. You
  can also authenticate directly with a bearer token or Linear API key — see the FAQ for details.»
- **[L5]** https://raw.githubusercontent.com/linear/linear/master/packages/sdk/src/schema.graphql (схема GraphQL из SDK
  Linear): «Returns individual notifications received by the authenticated user, with optional filters.»

## 6. MCP servers и connectors: можно ли ими заменить свой код чтения

| Сервер | Что даёт для проверки «что нового у меня» | Auth | Клиент без модели | Rate limit | Доступность | Источник |
|---|---|---|---|---|---|---|
| Slack MCP server | Поиск сообщений и файлов, чтение канала и треда | User token: confidential OAuth или PKCE; app с фиксированным app ID | Документ не запрещает. Но Slack пишет, что сервер сделан «for LLM consumption» и возвращает «natural language responses»; разбирать такой текст программой ненадёжно | Как у Web API по каждому tool; поиск — особые лимиты | Только Marketplace app или internal app; admin workspace одобряет | S12, S13 |
| Atlassian Rovo MCP server | `searchJiraIssuesUsingJql`, `getJiraIssue`; остальные tools ищутся через `discover` по описанию на естественном языке | OAuth 2.1 или API token, если admin включил | Да: API token прямо описан для «machine-to-machine and other non-interactive scenarios», включая «bots, and automated agents» | Официальных цифр нет. Часть tools тратит Rovo credits, запрос по одному продукту бесплатный | Любой MCP client; admin управляет доменами AI-инструментов | J10–J15 |
| Google Gmail MCP и Calendar MCP | Gmail: `search_threads`, `get_message`, `get_thread`. Calendar: `list_events`, `search_events`, `get_event` | OAuth client с отметкой «AI-powered agent» | Google рассчитывает на AI-агентов. Для client, который делает и «non-agent features», Google велит завести отдельный client | Не нашёл | Developer Preview, нужно членство в программе | G14–G18, C6 |
| Connectors claude.ai (Gmail, Calendar, а также Atlassian, Slack и другие из каталога) | То же, что у исходных servers, но вызывает модель | OAuth в claude.ai | Нет документированного вызова в обход модели. В Claude Code connectors приходят как MCP tools модели, только при входе подпиской claude.ai | — | Gmail connector: claude.com — «Pro, Max, Ultra, Team, and Enterprise»; help center — «all users» | A1–A3 |

### Цитаты

- **[A1]** https://code.claude.com/docs/en/mcp (прочитано в версии `.md`): «If you've logged into Claude Code with a
  claude.ai account, MCP servers you've added in claude.ai, known as connectors, are automatically available in Claude
  Code»; «Connectors from claude.ai are fetched only when your active authentication method is a claude.ai subscription
  login.»; в таблице «How connectors reach Claude Code»: «Terminal, VS Code, JetBrains, and Agent SDK sessions | Claude
  Code fetches them from claude.ai».
- **[A2]** https://support.claude.com/en/articles/10166901-use-google-workspace-connectors (прочитано в версии `.md`):
  «Google Workspace connectors (Gmail, Google Calendar, and Google Drive) are available for all users on Claude and
  Claude Desktop.»; «Send, reply to, and forward emails from Gmail. By default, outside Auto mode, Claude asks for your
  approval before each of these actions.»
- **[A3]** https://claude.com/docs/connectors/google/gmail (прочитано в версии `.md`): «It's available on Pro, Max,
  Ultra, Team, and Enterprise plans.»; «Claude reads and searches email only; it can't create, send, or modify
  messages.» Эта страница расходится с [A2] и в списке планов, и в том, может ли connector отправлять письма.

## 7. Приватность: что требуют vendors, если текст сообщения уходит в модель

- **Slack, приложение для чужих организаций.** Нужно явное разрешение организации, которая устанавливает app, на
  использование, обработку и хранение данных. Хранить данные — по минимуму. Учить на них LLM нельзя [S19].
- **Slack, Real-time Search API.** Данные нельзя хранить и копировать, учить на них нельзя, нельзя собирать данные в
  фоне без запроса пользователя [S11, S19]. Для internal app раздел Terms о раздаче за пределы организации не действует
  [S20].
- **Google, Limited Use.** Передавать данные можно только для функции, которая видна пользователю в интерфейсе, и
  только с его согласия [G-LU]. Людям читать данные нельзя без согласия пользователя или особых оснований [G-LU].
  Учить на данных модель можно только персональную модель этого же пользователя [G-WP].
- **Google, restricted scopes (Gmail).** Обязательны шифрование token-ов OAuth на диске и защита от prompt injection —
  Model Armor или своя [G-WP]. Для Workspace MCP Google отдельно требует проверять prompts и ответы на prompt injection
  [G18]. Делать постоянные копии данных Google запрещают Terms [G-WP]. В списке разрешённых применений Gmail scopes есть
  «providing generative AI summaries» [G-WP].
- **Atlassian.** Если worfy хранит personal data пользователей Jira, нужен отчёт в Personal data reporting API раз в 7
  дней. Atlassian советует не хранить и читать данные заново [J9]. В Developer Terms условий про обучение AI по
  ключевым словам не нашлось [J16].

### Цитаты

- **[G-LU]** https://developers.google.com/terms/api-services-user-data-policy: «Limit your use of data to providing or
  improving user-facing features that are prominent in the requesting application's user interface;»; «Transfers of
  data are not allowed, except: To provide or improve your appropriate access or user-facing features that are visible
  and prominent in the requesting application's user interface and only with the user's consent;»; «Don't allow humans
  to read the data, unless: You first obtained the user's affirmative agreement to view specific messages, files, or
  other data»
- **[G-WP]** https://developers.google.com/workspace/workspace-api-user-data-developer-policy (Last updated
  2026-09-03):
  - «Transferring, selling, or using user data to create, train, or improve a machine learning or artificial
    intelligence model beyond that specific user’s personalized model for the appropriate use case or user-facing
    feature.» (в списке запрещённого)
  - «Note: Remember, our Terms of Service prohibits the scraping, building databases (including databases for model
    training purposes), or otherwise creating permanent copies of Google User data. This includes keeping cached copies
    longer than permitted by the cache header.»
  - «Keeping user data and credentials, specifically tokens such as OAuth access and refresh tokens, encrypted at
    rest.» и «Protecting against prompt injection techniques by either using Google Cloud Platform's Model Armor or other
    prompt injection protection.» (в списке «Required security measures include:» для restricted scopes)
  - «Applications that enhance the email experience for productivity purposes (such as applications for customer
    relationship management, delayed sending of email or mail merge, or providing generative AI summaries)»
  - «If an app is only used by users within your own organization, then these additional requirements do not apply.»
  - «For example, granularly require users to confirm the MCP, tool, skill, or other agentic behavior invocation.»

## Что из этого следует для worfy

1. **Slack: одно общее app worfy вне Marketplace не годится для polling каналов.** У нового unlisted app
   `conversations.history` даёт 1 запрос в минуту и 15 сообщений [S1]. Real-time Search API и Slack MCP server ему
   закрыты [S11, S12]. Документированных путей для проверки раз в 10 минут два. Первый — каждый пользователь создаёт
   своё internal app: полные лимиты и Socket Mode для push без публичного адреса [S1, S7]. Но Terms считают
   коммерческой раздачей и «custom Application or Application template», если worfy подпадает под «Commercially
   Distribute» [S19]. Второй — Marketplace: review и не меньше 10 активных workspace на всё время review, без Socket
   Mode [S18, S7]. На обоих путях самая дешёвая проверка без модели — один вызов `search.messages` с user token (Tier
   2). Метод при этом помечен legacy [S3].
2. **Jira: personal API token и JQL через `/rest/api/3/search/jql` — самый простой путь без сервера.** Трафик API
   token не входит в points-квоту [J4]. Одна проверка — один запрос, интервал 10 минут лимиты не задевают. Push
   требует публичного HTTPS-сервера, значит остаётся polling [J8]. Поиск может не сразу показать свежие изменения [J1],
   поэтому окна проверок стоит перекрывать. Token живёт не дольше года [J5]: worfy должен заранее напомнить о замене.
   Admin может запретить token-ы внешним пользователям [J6]. Общее 3LO app требует client_secret и делит одну квоту
   65 000 points в час на всех пользователей worfy [J7, J4].
3. **Gmail: общий Google client worfy для всех = restricted verification, а при передаче через сервер ещё и
   ежегодная security assessment.** `gmail.readonly` и `gmail.metadata` — restricted [G6]. Оценка нужна приложениям,
   которые получают данные «from or through a third-party server» [G9]. Цену Google не публикует [G10]. Документированная
   альтернатива — Personal mode: каждый пользователь создаёт свой client, без проверки, без лимита в 100 пользователей и
   без истечения token-а через 7 дней [G11, G12]. Цена для пользователя — настроить проект Google Cloud. Сама проверка
   дешёвая: `history.list` стоит 2 quota units из 6 000 в минуту [G5, G1]. Push возможен только через Cloud Pub/Sub с
   pull-подпиской и повтором `watch` раз в 7 дней [G4].
4. **Google Calendar: polling через `syncToken`.** Push требует HTTPS с действительным сертификатом [C2]. Ответ 410
   означает полную пересинхронизацию [C1]. Чтение событий — sensitive scope: проверка с видео и privacy policy на домене
   worfy, без security assessment [C4]. Если тот же client просит и Gmail, действуют требования для restricted scopes
   [G9]. Лимит — 600 запросов в минуту на пользователя [C3].
5. **MCP servers и connectors claude.ai подходят для шага с моделью, не для проверки без модели.** Slack MCP отвечает
   текстом для LLM и закрыт для unlisted app [S13, S12]. Google Workspace MCP — Developer Preview и требует client с
   отметкой «AI-powered agent» [G14, G15]. Только Atlassian Rovo MCP прямо разрешает неинтерактивного клиента по API
   token, если admin это включил [J11]. Но его часовые лимиты не опубликованы, а часть tools тратит Rovo credits [J15,
   J12]. Connectors claude.ai сами приходят в сессии Claude Code при входе подпиской claude.ai [A1]. Значит, сессия
   Haiku для разбора новых элементов может дочитать источник через них, но каждое такое чтение — вызов модели.
6. **Перед отправкой текста в Haiku нужны явное согласие и минимум хранения.** Slack: для app в чужих организациях —
   явное разрешение организации и минимальное хранение; учить LLM нельзя [S19]. Google: передача только для видимой
   пользователю функции и с его согласия [G-LU]. Для Gmail обязательны шифрование token-ов на диске и защита от prompt
   injection [G-WP]. Atlassian: если worfy хранит personal data, раз в 7 дней нужен отчёт в Personal data reporting API
   [J9].

## Что проверить не удалось

- **Лимиты Atlassian Rovo MCP server.** На страницах Atlassian часовых цифр нет. Сторонние сайты и форум называют 500
  вызовов в час на Free, 1 000 на Standard и 1 000 плюс 20 на пользователя (до 10 000) на Premium и Enterprise. Проверить
  по источнику Atlassian не удалось.
- **Цена security assessment Google (CASA).** Google и App Defense Alliance цену не публикуют. Цифры со сторонних
  сайтов (около 540 USD за Tier 2 или 15 000–75 000 USD по старой схеме) не проверены.
- **Считает ли Google отправку текста письма в API Anthropic доступом «from or through a third-party server».** В
  документах Google прямого ответа нет. От этого зависит, нужна ли ежегодная оценка даже без своего сервера worfy.
- **Работает ли Personal mode client типа Desktop app с REST API Gmail, а не только с MCP.** В справке Personal mode
  описан как общий тип проекта, но живого вызова я не делал.
- **Подпадает ли бесплатный worfy под «Commercially Distribute» в Terms Slack.** Определение включает «a free App that
  connects to a paid product or service». Как это читается для приложения, которое работает с платным Claude, — вопрос
  к владельцу и юристу.
- **Atlassian 3LO в desktop-приложении.** Страница 3LO требует client_secret и не упоминает PKCE. Принимает ли Atlassian
  callback на `http://localhost`, не сказано.
- **Упоминания в JQL.** `comment ~ currentUser()` взят из статьи Atlassian Community, а не из документации JQL.
- **Срок жизни `search.messages`.** Метод помечен legacy, дату отключения не нашёл.
- **Socket Mode у раздаваемого app.** App-level token один на приложение. Как Slack доставляет события всех установок
  одного app в разные копии desktop-приложения, документация не описывает.
- **Токен GitHub CLI.** Документация разрешает `/notifications` только для personal access token (classic). Работает
  ли OAuth token, который выдаёт `gh`, не проверял.
- **Лимиты Google Workspace MCP.** Входят ли вызовы MCP в квоты Gmail API и Calendar API, не нашёл. Отказывает ли
  server клиенту без отметки «AI-powered agent», тоже не проверял.
- **Connector Gmail в claude.ai.** Две страницы Anthropic расходятся: «read-only» и «Send, reply to, and forward
  emails», «Pro, Max, Ultra, Team, and Enterprise» и «all users».
- **Устаревший текст changelog Slack.** Копии 2025 года говорили, что урезанный лимит придёт и к существующим
  установкам 2025-09-02. Текущая версия говорит обратное. Страница метода `conversations.history` урезанный лимит не
  упоминает вовсе. Для нового app worfy разница не важна.
- **Классификация `calendar.readonly` в Cloud console.** Google приводит «reading events stored in Google Calendar» как
  пример sensitive scope. Метку конкретного scope в консоли я не видел.
- **Вне этого исследования.** Код worfy не читался. Может ли процесс main вызвать tool MCP server без модели, где
  хранить token-ы и что делают проверки, пока Mac спит, — вопросы из того же вопроса 12, но на них отвечает чтение
  кода, а не документация vendors.
