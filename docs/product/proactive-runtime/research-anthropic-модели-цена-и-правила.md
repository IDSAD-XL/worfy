# Anthropic и фоновый слой worfy: модели, цены, правила subscription и похожие функции

- **Дата:** 2026-11-20. Все страницы ниже прочитаны 2026-11-20. Где текст сверялся с копией web.archive.org, дата копии
  указана рядом.
- **Тема** `proactive-runtime`, карта — [map.md](map.md). Вход — бриф владельца из PR #2052 (`brief.md` в ветке
  `docs/proactive-haiku-first-discovery-2026-11-20`; в main его ещё нет).
- **Статус:** исследование, не решение и не юридическая консультация.
- **Как проверено.** Документация Anthropic скачана как текст (у страниц docs есть версия `.md`, у help center — HTML).
  Цитаты сверены с этим текстом. Что изменилось после прежней заметки
  [research-правила-входа-для-внешних-пользователей.md](../roadmap-worfy/research-правила-входа-для-внешних-пользователей.md)
  (2026-11-08), сверено с копиями web.archive.org. Код worfy прочитан в одном месте: где закреплена модель Haiku (main
  `ad2169058`). Запросов к модели не было. Расчёты в долларах — мои, по ценам из цитат.

## 1. Модели и цены Claude API

### 1.1 Claude Haiku 5.5

- Model ID — `claude-haiku-5-5`, alias тот же. Выпущена 2026-10-07, статус Active, «Retirement: Not sooner than
  October 7, 2027». — https://platform.claude.com/docs/en/models/haiku-5-5/overview, 2026-11-20.
- Context window — 1M tokens, max output — 128K tokens; на Message Batches API — до 300K output tokens с beta header
  `output-300k-2026-03-24`. Вход — текст и изображения, выход — текст. —
  https://platform.claude.com/docs/en/models/haiku-5-5/overview, 2026-11-20.
- Назначение: «For high-volume, latency-sensitive tasks such as classification, extraction, and routing». Comparative
  latency — «Fastest». — https://platform.claude.com/docs/en/about-claude/models/overview, 2026-11-20.
- Thinking — adaptive, включён по умолчанию, default effort — `medium`: «Adaptive thinking is on by default. Control
  thinking depth with the effort parameter.» — https://platform.claude.com/docs/en/models/haiku-5-5/overview, 2026-11-20.
- Токенизатор новее, чем у Haiku 4.5: «It uses the same newer tokenizer as Claude 4.7 and later models, so the same text
  counts as approximately 30 percent more tokens than on Claude Haiku 4.5.» —
  https://platform.claude.com/docs/en/models/haiku-5-5/overview, 2026-11-20.
- Prompt caching: минимальная длина кэшируемого prompt — 512 tokens, «down from 4,096 on Claude Haiku 4.5». —
  https://platform.claude.com/docs/en/models/haiku-5-5/whats-new-haiku-5-5, 2026-11-20.
- Safety classifier может отказать, запасной модели на стороне сервера нет: «Handle `stop_reason: "refusal"` in your
  client. Server-side fallback isn’t available.» — https://platform.claude.com/docs/en/models/haiku-5-5/whats-new-haiku-5-5,
  2026-11-20.
- Tool use поддерживается, в том числе forced tool use. Forced tool use (`tool_choice` `any` или `tool`) отвечает 400
  только у «Claude Fable 5.2, Claude Mythos 5.2, Claude Opus 5.5, Claude Sonnet 5.5, Claude Fable 5.1, and Claude Mythos
  5.1»; Haiku 5.5 в этом списке нет. Там же: «Forcing a tool also skips thinking on every model that accepts forced tool
  use: the response starts with the `tool_use` block and has no `thinking` block.» —
  https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools, 2026-11-20.
- Скрытый system prompt для tool use у Haiku 5.5 — 286 tokens при `tool_choice` `auto` или `none` и 406 tokens при `any`
  или `tool` (у Haiku 4.5 — 496 и 588). — https://platform.claude.com/docs/en/about-claude/pricing, 2026-11-20.

### 1.2 Цены: строки таблиц со страницы Pricing

Источник всех строк этого подраздела — https://platform.claude.com/docs/en/about-claude/pricing (версия `.md`),
2026-11-20. Пробелы выравнивания убраны, текст ячеек не тронут.

Таблица Model pricing:

```text
| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |
| Claude Fable 5.2 | $8 / MTok | $10 / MTok | $16 / MTok | $0.20 / MTok<sup>1</sup> | $40 / MTok |
| Claude Opus 5.5 | $4 / MTok | $5 / MTok | $8 / MTok | $0.20 / MTok<sup>2</sup> | $20 / MTok |
| Claude Sonnet 5.5 | $2 / MTok | $2.50 / MTok | $4 / MTok | $0.10 / MTok<sup>2</sup> | $10 / MTok |
| Claude Haiku 5.5 (for prompts up to 100,000 tokens) | $0.10 / MTok | $0.125 / MTok | $0.20 / MTok | $0.01 / MTok | $0.50 / MTok |
| Claude Haiku 5.5 (for prompts over 100,000 tokens) | $0.50 / MTok | $0.625 / MTok | $1 / MTok | $0.05 / MTok | $2.50 / MTok |
| Claude Haiku 4.5 | $1 / MTok | $1.25 / MTok | $2 / MTok | $0.10 / MTok | $5 / MTok |
```

Сноски к ней: «1 Cache hits and refreshes on Claude Fable 5.2, Claude Mythos 5.2, Claude Fable 5.1, and Claude Mythos 5.1
are priced at 0.025x the base input price.» «2 Cache hits and refreshes on Claude Opus 5.5 and Claude Sonnet 5.5 are
priced at 0.05x the base input price.» «All other models use the standard 0.1x multiplier.»

Таблица Batch processing («The Batch API allows asynchronous processing of large volumes of requests with a 50 percent
discount on both input and output tokens.»):

```text
| Model | Batch input | Batch output |
| Claude Fable 5.2 | $4 / MTok | $20 / MTok |
| Claude Opus 5.5 | $2 / MTok | $10 / MTok |
| Claude Sonnet 5.5 | $1 / MTok | $5 / MTok |
| Claude Haiku 5.5 (for prompts up to 100,000 tokens) | $0.05 / MTok | $0.25 / MTok |
| Claude Haiku 5.5 (for prompts over 100,000 tokens) | $0.25 / MTok | $1.25 / MTok |
| Claude Haiku 4.5 | $0.50 / MTok | $2.50 / MTok |
```

Таблица Fast mode pricing (строк для Sonnet 5.5 и Haiku в ней нет):

```text
| Model | Input | Output |
| Claude Fable 5.2 | $16 USD / MTok | $80 USD / MTok |
| Claude Opus 5.5 | $8 USD / MTok | $40 USD / MTok |
```

Long context. Цена по длине prompt есть только у Haiku 5.5: «Claude 4.6 and later models (except Claude Haiku 5.5) and
Claude Mythos Preview include the full 1M token context window at standard pricing.» Правило для Haiku 5.5: «Claude Haiku
5.5 is priced by prompt length: a request whose prompt is over 100,000 tokens pays higher prices. A request’s prompt
length counts all of its input tokens, including cache reads and cache writes. Each request is priced on its own: a
request over the threshold pays the higher prices even when part of its prompt is a cache hit, and earlier requests keep
the prices they were billed at.» — https://platform.claude.com/docs/en/about-claude/pricing, 2026-11-20.

Токенизатор: «Claude 4.7 and later models and Claude Mythos Preview use a newer tokenizer that contributes to their
improved performance on a wide range of tasks. This tokenizer produces approximately 30% more tokens for the same text.»
— https://platform.claude.com/docs/en/about-claude/pricing, 2026-11-20.

Модели для сравнения: ID — `claude-fable-5-2`, `claude-opus-5-5`, `claude-sonnet-5-5`. У всех четырёх новых моделей
context window 1M и max output 128K; у Haiku 4.5 — 200K и 64K. Thinking: у Fable 5.2 и Opus 5.5 — «Adaptive (always
on)», у Sonnet 5.5 и Haiku 5.5 — «Adaptive». Default effort: Fable 5.2 и Sonnet 5.5 — `high`, Opus 5.5 и Haiku 5.5 —
`medium`. — https://platform.claude.com/docs/en/about-claude/models/overview, 2026-11-20.

### 1.3 Thinking: сколько стоит и где его можно выключить

- «Thinking has a cost: the tokens Claude spends reasoning are billed as output tokens, even when the thinking text isn’t
  returned to you, and they count toward `max_tokens` alongside the response text.» —
  https://platform.claude.com/docs/en/build-with-claude/thinking, 2026-11-20.
- В Claude API Haiku 5.5 можно запустить без thinking, но только при effort `high` и ниже. Строка таблицы (колонки:
  нет поля `thinking`, `"adaptive"`, `"enabled"` с `budget_tokens`, `"between_tools"`, `"disabled"`):
  `| Claude Haiku 5.5 | Adaptive thinking | Adaptive thinking | 400 error | 400 error | Thinking off at high effort or below |`.
  Предупреждение там же: «With thinking off, the model can skip a tool call it needs when you also request JSON output.»
  — https://platform.claude.com/docs/en/build-with-claude/thinking, 2026-11-20.
- В Claude Code выключить thinking у Haiku 5.5 нельзя: «You can't turn thinking off on Opus 5.5, Sonnet 5.5, Haiku 5.5,
  or the Fable models. … a saved `alwaysThinkingEnabled: false` or `MAX_THINKING_TOKENS=0` has no effect there.» Обход,
  который даёт сама документация: «Anthropic API: you can turn thinking off on models such as `claude-opus-5`,
  `claude-sonnet-5`, and `claude-haiku-4-5`. Aliases such as `sonnet` select models where you can't, so set the model by
  its ID.» — https://code.claude.com/docs/en/model-config, 2026-11-20. Agent SDK запускает тот же Claude Code, поэтому
  правило касается и его.
- Alias `haiku` в Claude Code на Anthropic API ведёт на Haiku 5.5 (строка `| Anthropic API | Opus 5.5 | Sonnet 5.5 |
  Haiku 5.5 |`); «Use v2.1.293 or later with Haiku 5.5.» — https://code.claude.com/docs/en/model-config, 2026-11-20.
- Этот обход уже сделан в коде worfy: `HAIKU_WITHOUT_THINKING = 'claude-haiku-4-5'`
  (`src/main/vendors/claude/terminal-ai.ts:70`). Комментарий рядом объясняет: через alias `haiku` Claude Code
  превращает thinking-off в adaptive thinking. Эту константу берут narrator (однострочный пересказ работы советника
  Product Session) и Terminal AI. — код main `ad2169058`, прочитан 2026-11-20.

### 1.4 Какие Haiku ещё есть и сколько они стоят

Строки таблицы Model status — https://platform.claude.com/docs/en/about-claude/model-deprecations, 2026-11-20:

```text
| API model name | Current state | Deprecated | Tentative retirement date |
| claude-haiku-5-5 | Active | N/A | Not sooner than October 7, 2027 |
| claude-haiku-4-5-20251001 | Active | N/A | Not sooner than October 15, 2026 |
| claude-3-5-haiku-20241022 | Retired | December 19, 2025 | February 19, 2026 |
| claude-3-haiku-20240307 | Retired | February 19, 2026 | April 20, 2026 |
```

- В API остались две Haiku: Haiku 5.5 и Haiku 4.5. Haiku 4.5 стоит $1 / MTok input и $5 / MTok output, batch — $0.50 и
  $2.50 (строки в 1.2). — https://platform.claude.com/docs/en/about-claude/pricing, 2026-11-20.
- Срок «Not sooner than October 15, 2026» у Haiku 4.5 уже прошёл; на 2026-11-20 она всё ещё Active. Как выводят модели:
  «Anthropic notifies customers with active deployments for models with upcoming retirements, providing at least 60
  days’ notice before model retirement for publicly released models.» Это касается и входа по плану: «Claude Code uses
  the Claude API, including when you sign in with a Claude plan, so this page’s dates apply.» —
  https://platform.claude.com/docs/en/about-claude/model-deprecations, 2026-11-20.
- В приложениях Claude Haiku 4.5 уже убрали из выбора: «On October 29, 2026, we removed Claude Haiku 4.5 from the model
  selector in chat, Claude Cowork, and Claude Design on the Free, Pro, and Max plans, including in Claude Desktop and
  Claude Mobile. Claude Haiku 5.5 replaced it.» Где она осталась: «This change didn't affect Haiku 4.5 in: Claude Code
  Team and Enterprise plans; Claude Platform (API)» (в источнике это список из двух пунктов). Про Claude Code на Pro,
  Max и Ultra статья ничего не говорит. —
  https://support.claude.com/en/articles/17444146-claude-haiku-4-5-was-removed-from-the-model-selector, 2026-11-20.
- Thinking у Haiku 4.5 по умолчанию выключен: `| Claude Haiku 4.5 | Thinking off | 400 error | Extended thinking | 400
  error | Thinking off |`. — https://platform.claude.com/docs/en/build-with-claude/thinking, 2026-11-20.
- За token Haiku 4.5 в 10 раз дороже Haiku 5.5 (до 100K). Тот же текст на Haiku 5.5 даёт примерно на 30% больше tokens,
  так что для одного текста Haiku 5.5 дешевле примерно в 7.7 раза (мой расчёт: 10 / 1.3).

### 1.5 Сверка с брифом

- «$0.10 / 1M input и $0.50 / 1M output для запросов до 100K input tokens» — **верно**: строка «Claude Haiku 5.5 (for
  prompts up to 100,000 tokens)» в 1.2. Страница продукта говорит то же: «On the Claude Platform, Haiku 5.5 costs $0.10
  per million input tokens and $0.50 per million output tokens for prompts up to 100K tokens, and $0.50 per million input
  tokens and $2.50 per million output tokens for prompts over 100K tokens.» — https://www.anthropic.com/claude/haiku,
  2026-11-20.
- «Для более длинных промптов тариф выше» — **верно**: $0.50 и $2.50. Уточнение: порог 100,000 считает и cache reads, и
  cache writes (цитата в 1.2).
- Арифметика брифа **верна** при этих ценах. 1,000 событий в сутки × 30 дней = 30,000 запросов. Вариант 1: 30M input ×
  $0.10 + 3M output × $0.50 = $3.00 + $1.50 = $4.50. Вариант 2: 150M × $0.10 + 9M × $0.50 = $15.00 + $4.50 = $19.50.
- **Не учтено в расчёте брифа** (факты из 1.1–1.4, расчёт мой):
  - Thinking tokens оплачиваются как output, а через Claude Code и Agent SDK у Haiku 5.5 thinking не выключается. Каждые
    100 thinking tokens на событие — это ещё 3M output tokens в месяц, то есть +$1.50.
  - Если tokens на событие мерили на Haiku 4.5, на Haiku 5.5 тот же текст даст примерно на 30% больше tokens.
  - Сейчас worfy закрепляет Haiku 4.5. По ценам API те же два варианта стоят на Haiku 4.5 $45 и $195 в месяц, на Sonnet
    5.5 — $90 и $390, на Opus 5.5 — $180 и $780.
  - Batch API вдвое дешевле ($2.25 и $9.75 на Haiku 5.5), но он асинхронный.
  - На subscription за запрос доллары не списываются: запрос расходует лимиты плана (раздел 3). По ценам API платят
    только после лимита и только с включёнными usage credits: «Usage credits are billed at standard API rates». —
    https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans, 2026-11-20.

## 2. Subscription в стороннем desktop-приложении

### 2.1 Что нового или изменилось после 2026-11-08

1. **Статья help center «Logging in to your Claude account» изменена 2026-11-17** (dateModified `2026-11-17T17:25:39Z`).
   В ней появился linked billing. Было (копия от 2026-11-08, dateModified `2026-11-07T02:30:39Z`): «…is through API key
   authentication through Claude Console or a supported cloud provider.» Стало: «The preferred way to access Anthropic
   services using third-party software, tools, or services (“third-party tools”), including open-source projects, is
   through API key authentication through Claude Console or a supported cloud provider, or through linked billing in
   apps that offer it.» В раздел Developers добавлено: «You can also offer linked billing, which lets your customers link
   their own Claude Console organization to your app and pay Anthropic directly, without sharing an API key.» Остальной
   текст раздела не изменился. — https://support.claude.com/en/articles/13189465-logging-in-to-your-claude-account,
   2026-11-20; копия
   https://web.archive.org/web/20261108005928/https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account.
2. **Linked billing — новый разрешённый путь для сторонних приложений, но не для subscription.** Это часть Claude
   Platform OAuth. В индексе документации он подписан «Linked billing (EAP)», на странице — «Claude Platform OAuth is a
   Beta Service». — https://platform.claude.com/llms.txt, 2026-11-20.
   - «Linked billing lets your customers pay for the Claude usage in your app through their own Claude organization.»
   - Кому подходит: «A customer can be billed this way only if their Claude Platform organization pays Anthropic directly
     for its API usage. … The same is true of organizations that have only a Claude subscription plan. Requests for them
     are refused with 403 `user_profile_not_billable`.» (Пропущена фраза о cloud marketplace.)
   - Месячные API credits планов не платят: «Some promotional credits from Anthropic can’t pay for these requests. These
     include the monthly API credits that come with Claude Max, Ultra, and Team plans.»
   - Запросы идут из организации разработчика: «Requests run in your organization, so your rate limits, model access,
     service tier, data retention, and encryption keys apply.»
   - Нужен back end разработчика: «Your back end needs an identity of its own to call the Claude API» (service account
     и Workload Identity Federation); client secret Anthropic не выдаёт.
   - Источник: https://platform.claude.com/docs/en/manage-claude/oauth-apps/organization-billing-connections, 2026-11-20.
   - У пользователя должна быть роль Admin или Billing в его организации Claude. И: «You may bill a customer only for the
     requests they direct you to make, never for your own usage.» —
     https://platform.claude.com/docs/en/manage-claude/oauth-apps/overview, 2026-11-20.
3. **Страница legal Claude Code не менялась**: каждая её фраза есть в копии от 2026-11-08 04:22 UTC. В прежней заметке
   не было двух мест, важных для фонового слоя:
   - «OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Ultra, Team, and Enterprise
     subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic
     applications.»
   - «Using the Claude Code name and logo. You can accurately say, in plain text, that your product has Claude Code
     preinstalled or that it runs Claude Code. But you can't use the Claude Code or Anthropic names or logos as part of
     your own product, feature, or company name, in your own logo, or in a way that suggests Anthropic built, endorses,
     or is partnered with your product.»
   - Источник: https://code.claude.com/docs/en/legal-and-compliance, 2026-11-20; копия
     https://web.archive.org/web/20261108042212/https://code.claude.com/docs/en/legal-and-compliance.
4. **Без изменений по сути:** заметка «Unless previously approved…» на обзоре Agent SDK
   (https://code.claude.com/docs/en/agent-sdk/overview, 2026-11-20); support-статья об Agent SDK на плане, dateModified
   `2026-10-30T19:44:39Z` (https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan,
   2026-11-20); Consumer Terms, «Effective Oct 8, 2025» (https://www.anthropic.com/legal/consumer-terms, 2026-11-20).
   Статья о месячных API credits изменена 2026-11-17, но фраза о `claude -p` та же, что в копии от 2026-11-16: «When
   you're signed in with your Claude plan instead, claude -p and Agent SDK usage still draw from your plan's usage limits
   and don't use your API credits.» —
   https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-ultra-and-team-plans, 2026-11-20.
5. **Usage Policy — новая редакция, «Effective Nov 12, 2026».** Фразы, которые цитирует 2.4, были и в прежней редакции
   (копия web.archive.org от 2026-10-14). — https://www.anthropic.com/legal/aup, 2026-11-20.
6. **Не было в прежней заметке:**
   - Headless без subscription: «Set `ANTHROPIC_API_KEY` before running it, because bare mode doesn't use your
     subscription login»; «In bare mode, Claude Code never reads OAuth credentials or the system keychain»; «`--bare` is
     the recommended mode for scripted and SDK calls, and will become the default for `-p` in a future release.» Эти
     фразы есть уже в копии web.archive.org от 2026-08-31. — https://code.claude.com/docs/en/headless, 2026-11-20.
   - Вход по плану кончается в известный срок и от работы не продлевается: «Using Claude Code doesn't extend the
     login.» «Renewing early matters most for sessions that run unattended. … A background session in agent view stops
     making progress if you have no other saved credential.» Если сохранён другой credential: «requests can use that
     credential instead, billed to its organization.» — https://code.claude.com/docs/en/authentication, 2026-11-20.
   - Agent SDK отдаёт этот срок: «`credential_expires_at`: the stored claude.ai login's latest expected end, as an ISO
     8601 timestamp. The login can end up to three days earlier.» (Agent SDK v0.3.318 и новее). —
     https://code.claude.com/docs/en/agent-sdk/typescript, 2026-11-20.

### 2.2 (a) Может ли приложение запускать Claude Code пользователя headless под его входом для фоновых задач, которые пользователь включил сам

Прямого ответа нет ни в одном тексте. Текстов, которые решили бы вопрос, после 2026-11-08 не появилось.

Тексты, на которые можно опереться:
- «Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude
  subscription, including where a platform hosts Claude Code as described under Can customers offer Claude Code in their
  products? above.» — https://code.claude.com/docs/en/legal-and-compliance, 2026-11-20.
- «Nothing changes for your plan: when you’re signed in with your Claude plan, the Claude Agent SDK and claude -p still
  draw from your subscription limits.» —
  https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan, 2026-11-20.
- Anthropic сама описывает работу без человека на subscription, но для своих средств:
  - «For CI pipelines, scripts, or other environments where interactive browser login isn't available, generate a
    one-year OAuth token with `claude setup-token`»; «This token authenticates with your Claude subscription and
    requires a Pro, Max, Ultra, Team, or Enterprise plan.» — https://code.claude.com/docs/en/authentication, 2026-11-20.
  - «If you authenticate with an OAuth token, runs use your Claude subscription instead of API billing.» —
    https://code.claude.com/docs/en/github-actions, 2026-11-20.
  - `CLAUDE_CODE_RETRY_WATCHDOG`: «Set to `1` for unattended sessions such as eval harnesses, CI jobs, or remote
    workers.» — https://code.claude.com/docs/en/env-vars, 2026-11-20.

Тексты против:
- «Developers building products or services that interact with Claude's capabilities, including those using the Agent
  SDK, should use API key authentication through Claude Console or a supported cloud provider. Anthropic does not permit
  third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro,
  Max, or Ultra plan credentials on behalf of their users.» — https://code.claude.com/docs/en/legal-and-compliance,
  2026-11-20.
- «Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits
  for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described
  in the Quickstart instead.» — https://code.claude.com/docs/en/agent-sdk/overview, 2026-11-20.
- «Subscription plans can only be used by subscribers, and the usage included in these plans is designed to support
  ordinary use of native Anthropic applications, including the Claude web, desktop, and mobile applications and Claude
  Code.» — https://support.claude.com/en/articles/13189465-logging-in-to-your-claude-account, 2026-11-20.
- В списке запретов Consumer Terms: «Except when you are accessing our Services via an Anthropic API Key or where we
  otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot,
  script, or otherwise.» — https://www.anthropic.com/legal/consumer-terms, 2026-11-20. Явные разрешения выше касаются
  Claude Code и средств Anthropic. Стороннее приложение, которое само запускает работу по событиям, не названо нигде.

Моё прочтение, не позиция Anthropic: фоновый слой по событиям добавляет к серой зоне из прежней заметки ещё один
признак — запуск без запроса человека. Два ключевых оборота не определены: «on behalf of their users» и «ordinary,
individual usage». Ответ может дать только Anthropic: «For questions about permitted authentication methods for your use
case, please contact sales.» — https://code.claude.com/docs/en/legal-and-compliance, 2026-11-20.

### 2.3 (b) Что действует для стороннего разработчика, который предлагает вход claude.ai или лимиты subscription в своём продукте

- Без предварительного согласия Anthropic так делать нельзя: см. две первые цитаты «против» в 2.2.
- Если продукт ставит или запускает Claude Code, нужны Commercial Terms и условия: «The Claude Code binary must not be
  modified.»; «Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf. Each end user
  must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider
  credential (Amazon Bedrock, Google Cloud's Agent Platform, Microsoft Foundry).» —
  https://code.claude.com/docs/en/legal-and-compliance, 2026-11-20.
- Учётные данные: «developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in
  to a Claude account must complete through Anthropic's own flow.» — https://code.claude.com/docs/en/legal-and-compliance,
  2026-11-20.
- «Applications that misrepresent their identity to Anthropic’s servers, attempt to route third-party traffic against
  subscription limits, or otherwise violate applicable terms or policies are prohibited and may be enforced against.» —
  https://support.claude.com/en/articles/13189465-logging-in-to-your-claude-account, 2026-11-20.
- Разрешённая замена — API key или, с 2026-11-17 в тексте help center, linked billing. Linked billing работает только
  для организаций Claude Platform, которые сами платят за API (2.1, п. 2).
- Имя: «runs Claude Code» обычным текстом — можно, в названии продукта или функции — нельзя (2.1, п. 3). Для Agent SDK:
  «Your product should maintain its own branding and not appear to be Claude Code or any Anthropic product.» —
  https://code.claude.com/docs/en/agent-sdk/overview, 2026-11-20.
- «Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice.» —
  https://code.claude.com/docs/en/legal-and-compliance, 2026-11-20.

### 2.4 (c) Работа без человека, Usage Policy, rate limits

- Automated access по Consumer Terms разрешён только с API key или с явного разрешения Anthropic (цитата в 2.2).
- Лимиты плана рассчитаны на обычную работу одного человека: «Advertised usage limits for Pro, Max, and Ultra plans
  assume ordinary, individual usage of Claude Code and the Agent SDK.» —
  https://code.claude.com/docs/en/legal-and-compliance, 2026-11-20.
- Usage Policy об агентах: «Agentic use cases must comply with the Usage Policy. Users are responsible for ensuring that
  agents they build or deploy, including actions those agents take through tools, browsers, or connected systems, comply
  with this Usage Policy.» В запретах: «Intentionally bypass or interfere with capabilities, restrictions, or guardrails
  established within our products, including by circumvention of the account sign-up or log-in process … without prior
  authorization from Anthropic». — https://www.anthropic.com/legal/aup, 2026-11-20.
- Лимиты могут меняться: «We may adjust usage limits at our discretion to manage capacity and ensure fair access to all
  users. For example, we may limit your usage with weekly and monthly caps or model and feature usage. We don't guarantee
  uninterrupted service.» — https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work,
  2026-11-20.
- Без человека вход по плану в какой-то день кончается, и фоновая работа останавливается или уходит на другой
  credential с другой оплатой (2.1, п. 6).
- Rate limits Claude API, если понадобится путь с API key: в Start tier у Haiku 5.5 — 4,000 RPM, 2,000,000 ITPM и
  400,000 OTPM; «`cache_read_input_tokens` (tokens read from cache) ✗ Do NOT count toward ITPM». —
  https://platform.claude.com/docs/en/api/rate-limits, 2026-11-20.
- У средств Anthropic для работы без человека свои часовые лимиты запусков — см. 4.1.

## 3. Лимиты subscription для headless и фоновой работы

### 3.1 Из чего состоят лимиты

- «Pro and Max plans have a five-hour session limit and a weekly limit. Ultra plans have a weekly limit, and verified
  Ultra accounts don't have a five-hour session limit. … Max and Ultra plans also have a separate weekly limit for Fable.
  These limits are shared across Claude and Claude Code, meaning all activity in both tools counts against the same
  limits.» — https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-max-or-ultra-plan, 2026-11-20.
- У Opus и Sonnet есть ещё свои лимиты: «The session and weekly limits are shared across all models, so switching models
  doesn't restore access. The Opus and Sonnet limits each apply only to requests to that model family, so switching to a
  model outside the family with `/model` keeps you working.» И: «Usage counts against the session and weekly allowances
  at the same time.» — https://code.claude.com/docs/en/errors, 2026-11-20.
- Пятичасовое окно: «The period starts when you send your first message, and your limit resets in full five hours
  later.» Недельное: «Weekly limits reset at a fixed time each week that is assigned to your account.» —
  https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work, 2026-11-20.
- Размеры: «Max gives you 5x the usage of Pro every 5 hours and every week. Ultra gives you 10x the weekly usage of Pro,
  with no 5-hour limit for verified accounts.» Fable на Max и Ultra — «Fable included, up to half your weekly limit». —
  https://claude.com/pricing, 2026-11-20. «Ultra is the new name for the Max 20x plan, and Max is the new name for Max
  5x.» — https://code.claude.com/docs/en/feature-availability, 2026-11-20.
- Fable может идти не из лимитов: «Depending on your plan and seat tier, Fable usage can bill to usage credits instead of
  drawing on your plan's included limits.» — https://code.claude.com/docs/en/model-config, 2026-11-20.

### 3.2 Headless и фоновые запуски расходуют те же лимиты

- Agent SDK и `claude -p` на входе по плану расходуют лимиты subscription (цитаты в 2.1, п. 4, и в 2.2).
- Cloud scheduled tasks: «Scheduled tasks draw down subscription usage the same way interactive sessions do.» —
  https://code.claude.com/docs/en/routines, 2026-11-20.
- Agent view: «Each session uses your subscription quota independently». — https://code.claude.com/docs/en/agent-view,
  2026-11-20.
- Projects: «Project usage counts against the same plan limits as your other Claude Code sessions, and a project can't
  spend past those limits on its own.» — https://code.claude.com/docs/en/claude-projects, 2026-11-20.
- Cloud sessions: «It counts toward your plan's usage limits alongside the rest of your Claude and Claude Code usage,
  and there's no separate charge for the cloud VM.» — https://code.claude.com/docs/en/claude-code-on-the-web, 2026-11-20.
- Сам Claude Code шлёт фоновые запросы Haiku-модели под тем же входом: `ANTHROPIC_DEFAULT_HAIKU_MODEL` — «Model ID that
  the `haiku` alias resolves to, also used for background functionality». — https://code.claude.com/docs/en/env-vars,
  2026-11-20. И: «Session recap and idle compaction can use tokens while you're idle.» —
  https://code.claude.com/docs/en/costs, 2026-11-20.
- Отдельной квоты или скидки для headless и фоновой работы в документации нет. Все найденные тексты говорят, что она
  считается так же, как интерактивная.

### 3.3 Весит ли Haiku в лимитах меньше Opus и Sonnet

- **Числом это не документировано.** Тексты говорят только, что модель влияет на расход: «Your usage is affected by
  several factors, including the length and complexity of your conversations, the features you use, which Claude model
  you're chatting with, and the effort level you've selected.» —
  https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work, 2026-11-20. И: «How much you can
  do depends on the length and complexity of your conversations, the model you choose, and the features you use, so
  there's no fixed message count.» — https://claude.com/pricing, 2026-11-20.
- Запросы Haiku идут в общие пятичасовой и недельный лимиты: они «shared across all models» (3.1). Отдельные лимиты
  документация называет только у Opus, Sonnet и Fable; отдельного лимита Haiku в ней нет.
- Что документировано без чисел:
  - Effort: «Low and Medium work well for routine tasks and stretch your usage further.» У Haiku 5.5 default effort —
    `medium`. — https://support.claude.com/en/articles/8664678-change-the-model-effort-and-thinking-settings, 2026-11-20.
  - Кэш: «When you reference that content again while it’s still cached, cached portions count less against your limits
    than new content.» — https://support.claude.com/en/articles/9797557-usage-limit-best-practices, 2026-11-20.
  - TTL кэша на плане: «Unless you choose a TTL yourself, Claude Code requests the one-hour TTL only on a Claude
    subscription within your plan's included usage.» — https://code.claude.com/docs/en/prompt-caching, 2026-11-20.
  - Thinking: «Thinking cannot be turned off in Claude when using Claude Fable 5.2, Claude Haiku 5.5, Claude Sonnet 5.5,
    Claude Opus 5.5, Claude Fable 5.1, or Claude Opus 5.» —
    https://support.claude.com/en/articles/8664678-change-the-model-effort-and-thinking-settings, 2026-11-20.

### 3.4 Что происходит у границы лимита

- Шаг дописывается: «If you reach your five-hour session limit while Claude Code is partway through a response, it may
  keep working briefly so it can finish the step in progress instead of stopping mid-step.» —
  https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-max-or-ultra-plan, 2026-11-20.
- Ожидание сброса — только в интерактивной Session: «In an interactive session signed in with a claude.ai subscription,
  Claude Code can also wait in the open session and continue the interrupted task shortly after the reset.» —
  https://code.claude.com/docs/en/errors, 2026-11-20.
- Для работы без человека — `CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS`: «Checks are made only for a claude.ai
  subscription's session or weekly limit while usage credits aren't in use». — https://code.claude.com/docs/en/env-vars,
  2026-11-20.
- С включёнными usage credits работа продолжается по ценам API (1.5).

### 3.5 Что это значит для расчёта в брифе

- На subscription цена фонового вызова — доля лимитов плана, а не доллары. Перевести доллары API в долю лимита по
  документации нельзя: коэффициентов нет.
- Каждый фоновый вызов Haiku уменьшает те же пятичасовой и недельный лимиты, из которых идут Session-ы пользователя
  (3.1, 3.2).

## 4. Похожие функции Anthropic

### 4.1 Cloud scheduled tasks (раньше routines)

Сохранённая конфигурация Claude Code — prompt, репозитории, connectors, — которая сама запускает облачную Session.
Research preview. Источник подраздела — https://code.claude.com/docs/en/routines, 2026-11-20, если не указан другой.
- **Trigger:** «Schedule: run on a recurring cadence like hourly, nightly, or weekly, or once at a specific future
  time»; «API: trigger on demand by sending an HTTP POST to the task's own endpoint with a bearer token»; «GitHub: run
  automatically in response to repository events such as pull requests or releases». События GitHub в списке — Pull
  request, Release, Issue; комментарии и CI отдельными событиями не названы. Минимальный интервал расписания — 1 час
  (https://code.claude.com/docs/en/scheduled-tasks, 2026-11-20).
- **Scope:** аккаунт пользователя; задача держит один или несколько репозиториев и connectors аккаунта claude.ai; идёт
  в облаке Anthropic или в self-hosted environment организации.
- **Сама или предлагает:** работает сама. «Claude pushes its work to a branch prefixed with `claude/` unless your prompt
  directs it to push to another branch.» Примеры в документации: draft PR, inline comments, сводка в Slack.
- **Подтверждение:** Session стартует в auto mode: «a classifier model allows or blocks actions that would otherwise wait
  for your approval». Run останавливается и ждёт человека на ask rules и на повторных блокировках. Ветки защищают
  правилами GitHub.
- **Лимиты:** subscription — как у интерактивной Session (3.2). Часовые лимиты запусков: «Scheduled runs, including
  one-off runs | 100 per hour | Your account»; «Run now, API fires, and setting a one-off task to run again | 30 per hour
  | Each scheduled task, one count shared by all three». События GitHub: «GitHub webhook events are subject to per-task
  and per-account hourly caps. Events beyond the limit are dropped until the window resets.»
- **Планы:** «Scheduled tasks are available on Pro, Max, Ultra, Team, and Enterprise plans.»

### 4.2 Projects в claude.ai/code

Источник подраздела — https://code.claude.com/docs/en/claude-projects, 2026-11-20.
- **Что это:** «A project is one ongoing conversation where Claude coordinates a stream of related work for you. You tell
  it what needs doing and it starts a thread for each task.» Координатор видит отчёты threads: «It sees what threads
  report back, not every step they take.»
- **Trigger:** сообщения пользователя в разговор проекта. Thread, который следит за своим PR, просыпается сам: «an idle
  thread wakes up and uses your plan again when CI fails or a review comment arrives on its pull request». Расписание —
  через cloud scheduled task внутри проекта.
- **Scope:** один пользователь: «A project belongs to one user.» Репозитории GitHub и загруженные файлы. Thread — это
  cloud session или, по просьбе, Session на машине пользователя через Remote Control.
- **Сама или предлагает:** по умолчанию координатор сам заводит threads, threads открывают PR. Можно попросить
  «Propose threads and wait for my go-ahead before starting them», но «They're instructions Claude keeps to, not enforced
  settings». Thread стартует в auto mode, если он доступен (https://code.claude.com/docs/en/routines, 2026-11-20).
- **Лимиты и модели:** «The enforced limit is 500 new threads per day across your projects.» «A new project runs Opus
  everywhere, with high effort for threads and low effort for the conversation».
- **Планы:** «Projects are in public beta on Pro, Max, and Ultra plans and rolling out gradually.» «Projects aren't
  offered on Team or Enterprise plans yet.» Работают в claude.ai/code, Desktop и мобильном приложении, не в CLI.

### 4.3 Cloud sessions (Claude Code on the web) и Auto-fix pull requests

Источник подраздела — https://code.claude.com/docs/en/claude-code-on-the-web, 2026-11-20.
- **Что это:** Session Claude Code в облаке; «The session keeps running after you close your laptop».
- **Trigger Auto-fix:** события GitHub по PR — «new review comments and CI check failures». Включает пользователь:
  кнопка Auto-fix, `/autofix-pr` в терминале или просьба в мобильном приложении.
- **Scope:** один PR. Нужен Claude GitHub App на репозитории.
- **Сама или предлагает:** «Clear fixes: if Claude is confident in a fix and it doesn't conflict with earlier
  instructions, Claude makes the change, pushes it, and explains what was done in the session»; «Ambiguous requests: if a
  reviewer's comment could be interpreted multiple ways or involves something architecturally significant, Claude asks
  you before acting». Отвечает в review threads от GitHub-аккаунта пользователя с пометкой Claude Code. На merge conflict
  сам не реагирует: «GitHub does not emit a webhook when the base branch advances and creates a merge conflict».
- **Подтверждение:** что считать «clear fix», решает модель.
- **Планы:** «Cloud sessions are available on Pro, Max, Ultra, and Team plans, and for Enterprise users with premium
  seats or Chat + Claude Code seats.»

### 4.4 Claude Code GitHub Actions

Источник подраздела — https://code.claude.com/docs/en/github-actions, 2026-11-20.
- **Что это:** GitHub Action на Agent SDK; запускает Claude Code в workflow репозитория.
- **Trigger:** interactive mode — «the trigger phrase, `@claude` by default, in an issue or pull request comment, in a
  pull request review, or in the body or title of a newly opened issue». Automation mode — workflow с `prompt` на любом
  событии GitHub, в том числе по расписанию.
- **Scope:** репозиторий (workflow-файл); secret — на репозиторий или на организацию.
- **Сама или предлагает:** «Mention `@claude` in a pull request or issue comment to have Claude analyze code, implement
  changes, and push commits.» Результат — комментарий к issue или PR, в automation mode — лог workflow.
- **Подтверждение:** автор события должен иметь write access; боты отклоняются, если их нет в `allowed_bots`.
- **Оплата и планы:** API key или `CLAUDE_CODE_OAUTH_TOKEN` subscription, «available on Pro, Max, Ultra, Team, and
  Enterprise plans»; плюс минуты GitHub Actions.

### 4.5 Code Review

- **Что это:** «Claude reviews the pull requests in your GitHub repositories»; «A review never approves or blocks the
  pull request». — https://code.claude.com/docs/en/code-review, 2026-11-20.
- **Trigger:** режим репозитория — «Once after PR creation», «After every push» или «Manual (@claude review)». —
  https://code.claude.com/docs/en/code-review-setup, 2026-11-20.
- **Scope:** организация Claude; репозитории выбирает Owner.
- **Сама или предлагает:** inline comments, сводка и check run; код не правит.
- **Оплата:** «Code Review is billed on token usage through usage credits, separately from your plan's included
  usage.» — https://code.claude.com/docs/en/code-review-costs, 2026-11-20.
- **Планы:** Team и Enterprise; на Pro, Max и Ultra — нет. — https://code.claude.com/docs/en/feature-availability,
  2026-11-20.

### 4.6 Desktop: PR monitoring, предложенные задачи, локальные scheduled tasks

- **PR monitoring:** «To have Claude fix failing checks, or to have GitHub merge the pull request, turn on Auto-fix or
  Merge when ready.» В локальной Session Auto-fix отвечает и на новые review comments других людей, если автор —
  owner, член организации, collaborator или GitHub App. Нужен `gh`. — https://code.claude.com/docs/en/desktop,
  2026-11-20.
- **Предложенные задачи:** «When Claude notices something worth fixing outside your current task, it suggests that work
  as a task.» Задача стартует только по кнопке Start, Do it here или Start all. — https://code.claude.com/docs/en/desktop,
  2026-11-20.
- **Локальные scheduled tasks:** «runs on your machine with direct access to your files and tools, but only fires while
  the app is open and your computer is awake». — https://code.claude.com/docs/en/desktop-scheduled-tasks, 2026-11-20.

### 4.7 Channels

Источник подраздела — https://code.claude.com/docs/en/channels, 2026-11-20.
- **Что это:** «A channel is an MCP server that pushes events into your running Claude Code session, so Claude can react
  to things that happen while you're not at the terminal.» Пример в документации — webhook от CI.
- **Trigger:** событие внешней системы через channel plugin; «Events only arrive while the session is open».
- **Scope:** одна уже открытая локальная Session. В research preview — только plugins из allowlist.
- **Планы:** Pro, Max и Ultra — да; Team и Enterprise — «Admin-enabled»
  (https://code.claude.com/docs/en/feature-availability, 2026-11-20). «They require Anthropic authentication through
  claude.ai or a Console API key».

### 4.8 Agent view и `/loop`

- **Agent view:** «one screen for all your background sessions»; фоновые Session-ы работают без открытого терминала, их
  держит supervisor process. Каждую запускает пользователь: «Agent view runs sessions on your machine and you dispatch
  each one». Research preview. — https://code.claude.com/docs/en/agent-view, 2026-11-20.
- **`/loop`:** повторяет prompt по расписанию внутри открытой Session. «`/proactive` is now an alias for `/loop`»
  (v2.1.105, 2026-04-13). — https://code.claude.com/docs/en/scheduled-tasks и https://code.claude.com/docs/en/changelog,
  2026-11-20.

### 4.9 Dispatch

- «Dispatch is a persistent conversation with Claude that lives in Cowork. You message Dispatch a task, and it decides
  how to handle it.» Code Session он может открыть сам: «or Dispatch decides the task is development work and spawns one
  on its own». Когда Session закончила или ждёт одобрения, приходит push-уведомление на телефон.
- **Trigger:** сообщение пользователя.
- **Планы:** «Dispatch requires a Pro, Max, or Ultra plan and is not available on Team or Enterprise plans».
- Источник: https://code.claude.com/docs/en/desktop, 2026-11-20.

### 4.10 Другое со словом proactive

- Mod «You should know» (v2.1.287, 2026-10-01): «a built-in mod where a side agent watches your back and flags things
  you or Claude might miss», «(for first-party sessions with telemetry on)». Работает внутри Session. —
  https://code.claude.com/docs/en/changelog, 2026-11-20.
- Output style Proactive: «Claude starts implementing as soon as you send a task. It makes reasonable assumptions about
  routine decisions rather than stopping to ask»; «Switching to the Proactive style doesn't change your permission
  mode.» — https://code.claude.com/docs/en/output-styles, 2026-11-20.
- Claude Code in Slack: «When you mention `@Claude` with a coding task, Claude automatically detects the intent and
  creates a Claude Code cloud session»; «This earlier version answers mentions only from Pro, Max, and Ultra accounts in
  workspaces not connected to Claude Tag.» — https://code.claude.com/docs/en/slack, 2026-11-20. Claude Tag — Claude в
  каналах Slack команды «on Team and Enterprise plans». — https://code.claude.com/docs/en/claude-projects, 2026-11-20.

### 4.11 Сводка

Таблица собрана из 4.1–4.10.

| Функция | Где идёт работа | Trigger | Реагирует на review comment или CI | Действует сама | Планы |
| :- | :- | :- | :- | :- | :- |
| Cloud scheduled tasks | облако | расписание, HTTP POST, GitHub (PR, release, issue) | отдельными событиями не названы | да, auto mode | Pro, Max, Ultra, Team, Enterprise |
| Projects | облако или Remote Control | сообщение пользователя координатору; события PR thread-а | да, thread своего PR | да; «предлагать» — просьба, не настройка | Pro, Max, Ultra (beta) |
| Auto-fix в cloud session | облако | события GitHub по PR | да | ясные правки — да, неясные — спрашивает | Pro, Max, Ultra, Team, Enterprise (premium) |
| Auto-fix в Desktop | машина пользователя | статус PR через `gh` | да | да | в прочитанном тексте не указаны |
| GitHub Actions | runner GitHub | `@claude`, любое событие GitHub | да, по `@claude` или по workflow | да | OAuth token: Pro, Max, Ultra, Team, Enterprise; или API key |
| Code Review | облако | открытие PR, push, `@claude review` | нет, только ревью | комментирует, код не правит | Team, Enterprise |
| Channels | открытая локальная Session | push из MCP server (CI, чат) | если channel их шлёт | в рамках Session | Pro, Max, Ultra; Team, Enterprise — admin |
| Agent view, `/loop` | машина пользователя | запуск пользователем, интервал | нет | в рамках Session | в прочитанном тексте не указаны |
| Dispatch | Cowork и Desktop | сообщение пользователя | нет | может сам открыть Code Session | Pro, Max, Ultra |

Что из брифа у Anthropic уже есть (по 4.1–4.10):
- Реакция на падение CI и на review comments в PR: Auto-fix в cloud session и в Desktop, threads в Projects. Для облака
  нужен Claude GitHub App, для Desktop — `gh`.
- Запуск агента по событию GitHub: cloud scheduled tasks и GitHub Actions.
- Координатор над потоком задач: Projects (облако, один пользователь, Pro, Max, Ultra) и Dispatch (Cowork).
- Доставка внешних событий в уже открытую локальную Session: Channels (research preview).
- В прочитанных страницах я не нашёл функции, которая на машине пользователя следит сразу за всеми его локальными
  проектами и по событиям сама предлагает следующий шаг. Ближе всего — Projects (но в облаке и только на репозиториях
  GitHub и загруженных файлах) и Dispatch (по сообщению пользователя).

## Что проверить не удалось

1. Работает ли `claude-haiku-4-5` в Claude Code на Pro, Max и Ultra после 2026-10-29. Статья help center называет
   только Claude Code на Team и Enterprise и API; документация Claude Code про план не говорит. Нужен живой запрос.
2. Во сколько раз запрос Haiku 5.5 легче для лимитов плана, чем Opus или Sonnet. Anthropic это не публикует.
3. Сколько tokens тратит один вызов `query()` Agent SDK в духе narrator: system prompt Claude Code, thinking Haiku 5.5.
   Не измерял; это видно в `usage` результата SDK.
4. Распространится ли «will become the default for `-p`» про `--bare` на `query()` Agent SDK и что тогда будет со
   входом по плану. Документация не говорит.
5. Считает ли Anthropic фоновый слой, который пользователь включил сам, «ordinary, individual usage» или «route requests
   … on behalf of their users». Ответить может только Anthropic (contact sales).
6. Будет ли linked billing работать с subscription. Страницы этого не обещают; сейчас это EAP, beta.
7. Числа часовых лимитов на события GitHub у cloud scheduled tasks («per-task and per-account hourly caps») не
   опубликованы.
8. Реагируют ли threads в Projects на комментарии ботов. Документация говорит только о CI и review comments.
9. Сверка страницы legal с копией от 2026-11-08 шла по наличию каждой фразы, а не построчным сравнением разметки.
10. Когда на странице authentication появились фразы о сроке входа (рядом упомянута v2.1.318), не проверял.
11. Числа rate limits Claude API кроме Start tier не выписывал.
