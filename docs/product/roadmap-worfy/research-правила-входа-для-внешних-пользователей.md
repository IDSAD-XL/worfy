# Правила входа для внешних пользователей worfy: Anthropic и OpenAI

- **Дата:** 2026-11-08, main `db89e600d`. Все страницы ниже прочитаны 2026-11-08.
- **Ticket:** [02](issues/02-правила-входа-для-внешних-пользователей.md) темы `roadmap-worfy`; карта — [map.md](map.md).
- **Статус:** исследование, не решение и не юридическая консультация.
- **Вопрос.** Можно ли раздавать worfy другим людям так, как он работает сейчас: Claude Code через Agent SDK и Codex
  CLI на подписке самого пользователя, вход через flow Anthropic и OpenAI, без API key? При каких условиях?
- **Как проверено.** Страницы Anthropic и OpenAI скачаны как текст; цитаты сверены с ним программно. Код worfy прочитан
  только там, где он запускает Claude Code и Codex и где мог бы касаться учётных данных. Похожие приложения и историю
  блокировок собрали два research-агента; ключевые их цитаты я перечитал, остальное помечено «по данным агента».

## 1. Вердикт

- **(a) Бесплатно, open source, каждый ставит сам и входит в немодифицированный Claude Code через flow Anthropic —
  серая зона, которую сейчас терпят.** Страница legal разрешает конечному пользователю входить своей подпиской в
  немодифицированный Claude Code даже внутри чужого продукта, а сотрудник Anthropic писал «We want to encourage local
  development and experimentation with the Agent SDK and claude -p»; но тексты для разработчиков велят «tool for
  others» брать API key, а правила для сторонних инструментов в 2026 году менялись несколько раз.
- **(b) То же, но платно — без письменного согласия Anthropic нельзя:** «If you're building a business on top of the
  Agent SDK, you should use an API key instead», и вход claude.ai в продукте на Agent SDK допустим только «previously
  approved». Брать деньги за само приложение правила не запрещают.
- **(c) Codex со входом ChatGPT: бесплатно и локально — можно, платно — нельзя** без партнёрства Sign in with ChatGPT:
  OpenAI разрешает локальным и open source приложениям «continue using» вход через app-server, а для «commercial or
  hosted services» он «has never been permitted».
- Даже для (a) сейчас не выполнены два условия: worfy убирает `ANTHROPIC_API_KEY` у Claude Code, что читается как
  ограничение способа входа, и в репозитории нет лицензии; принял ли издатель Commercial Terms — неизвестно.

## 2. Правила и точные цитаты

**Anthropic, страница legal Claude Code** — https://code.claude.com/docs/en/legal-and-compliance
- «Can customers offer Claude Code in their products?»: «Unless we've mutually agreed otherwise, preinstalling or
  running Claude Code in your products or services (e.g. in hosted sandboxes or other agent infrastructure) requires
  agreeing to our Commercial Terms of Service and complying with the conditions below»
- Условие 1: «The Claude Code binary must not be modified. Claude Code must be installed and run as published by
  Anthropic, and customers may not remove, disable, or restrict any authentication method built into it (including
  methods that permit signing in with a Claude account or the user's own API key).»
- Условие 2: «Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf. Each end user
  must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider
  credential»
- «Authentication and credential use»: «Developers building products or services that interact with Claude's
  capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a
  supported cloud provider. Anthropic does not permit third-party developers to offer Claude.ai login into their own
  applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users.
  Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a
  Claude account must complete through Anthropic's own flow.»
- Там же: «Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude
  subscription, including where a platform hosts Claude Code as described under Can customers offer Claude Code in
  their products? above.» И: «Anthropic reserves the right to take measures to enforce these restrictions and may do
  so without prior notice.»

**Anthropic, «Logging in to your Claude account»** (на неё ссылается страница legal; изменена 2026-11-07; абзац есть
и в копии web.archive.org от 2026-04-16) — https://support.claude.com/en/articles/13189465-logging-in-to-your-claude-account
- «The preferred way to access Anthropic services using third-party software, tools, or services ("third-party
  tools"), including open-source projects, is through API key authentication through Claude Console or a supported
  cloud provider. Anthropic may at its discretion allow paid subscribers who have enabled usage credits to use certain
  third-party tools to access Anthropic services included in paid subscription plans, but reserves the right to draw
  use of such third-party tools from usage credits rather than subscription limits.»
- «Use of third-party tools that misrepresent their identity to Anthropic's servers, attempt to route third-party
  traffic against subscription limits, or otherwise violate applicable terms or policies is prohibited»
- Раздел «Developers»: «If you're building a product, application, or tool for others, use API key authentication
  through Claude Console or a supported cloud provider.»

**Anthropic, обзор Agent SDK** — https://code.claude.com/docs/en/agent-sdk/overview (та же заметка есть в Quickstart)
- «Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits
  for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described
  in the Quickstart instead.»

**Anthropic, support-статья об Agent SDK на подписке** —
https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan. На 2026-10-10 (копия
web.archive.org) там стояло «You can still use the Claude Agent SDK, claude -p, and third-party apps with your
subscription limits» — эту фразу цитирует ADR-0058 (Terminal AI). Теперь «third-party apps» из неё убраны:
- «Update June 15, 2026: We've paused the previously-announced changes to Claude Agent SDK usage. For now, nothing has
  changed: Claude Agent SDK, claude -p, and third-party app usage still draw from your subscription limits.»
- «Update October 7, 2026: … Nothing changes for your plan: when you're signed in with your Claude plan, the Claude
  Agent SDK and claude -p still draw from your subscription limits.»

**Anthropic, Consumer Terms** (Effective Oct 8, 2025) — https://www.anthropic.com/legal/consumer-terms
- В списке запретов: «Except when you are accessing our Services via an Anthropic API Key or where we otherwise
  explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script,
  or otherwise.»
- «You may not share your Account login information, Anthropic API key, or Account credentials with anyone else. You
  also may not make your Account available to anyone else.»

**OpenAI, Codex app-server** — https://developers.openai.com/codex/app-server, раздел «Auth endpoints»
- «If you've built a local or open-source application using Codex app-server authentication, you can continue using
  it, though we recommend migrating to Sign in with ChatGPT so users have greater control over and visibility into
  their usage. … App-server authentication has never been permitted for commercial or hosted services. We launched
  Sign in with ChatGPT to support these use cases»

**OpenAI, Sign in with ChatGPT** — https://developers.openai.com/siwc/token-sharing-open-source и
https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt (пример — open source приложение на Electron)
- «These docs explain ChatGPT plan usage for open-source and locally hosted apps. If you're interested in offering it
  in a paid or remotely hosted app, complete the interest form.»
- «At launch, ChatGPT plan usage is available to open-source projects, personal projects that run locally, and
  selected private apps.»

**OpenAI, вход в Codex** — https://developers.openai.com/codex/auth: «Use API key authentication for programmatic
Codex CLI workflows, such as CI/CD jobs. Don't expose Codex execution in untrusted or public environments.»

**OpenAI Terms of Use** (Effective January 1, 2026) — https://openai.com/policies/terms-of-use/ (прямой запрос дал 403,
текст прочитан через r.jina.ai): «You may not share your account credentials or make your account available to anyone
else»; в списке «What you cannot do»: «Automatically or programmatically extract data or Output».

## 3. Что в worfy можно прочитать как нарушение

1. **worfy везёт Claude Code внутри себя:** `claude` из пакета `@anthropic-ai/claude-agent-sdk-<platform>-<arch>`
   лежит в `.app` (`electron-builder.yml:59-62`, `src/main/vendors/claude/options.ts:118-122`). Лицензия пакета:
   «© Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements outlined here: …». Это «preinstalling
   or running Claude Code in your products»: издатель должен принять Commercial Terms. Binary не меняется.
2. **Каждая Session — это `query()` Agent SDK** (`src/main/vendors/claude/options.ts:609-616`). Значит, worfy — продукт
   «using the Agent SDK» и «tool for others». К нему относятся «should use API key authentication» и «Unless
   previously approved». Это главная серая зона: исключение для конечного пользователя говорит о binary, а не о SDK.
3. **worfy убирает `ANTHROPIC_API_KEY` и `ANTHROPIC_AUTH_TOKEN`** из окружения Claude Code
   (`src/main/agent/env.ts:10-11`, `:38`, `:77-81`; ADR-0007 — окружение процесса Claude Code). Это можно прочитать
   как «restrict any authentication method built into it (including … the user's own API key)». Смягчает: в
   Session-ах остаются `apiKeyHelper` из настроек пользователя (`options.ts:614`) и вход в Console через `/login`.
4. **Вход делает сам Claude Code:** worfy открывает `claude` в Terminal Node (терминал внутри worfy), пользователь
   пишет `/login` (`src/main/vendors/claude/account.ts:36-38`, `src/main/first-run/checks.ts:308`). Это flow Anthropic.
5. **Токены worfy не трогает.** В `src/` нет чтения Keychain-записи Claude Code, `~/.claude/.credentials.json`,
   `CLAUDE_CODE_OAUTH_TOKEN` или `~/.codex/auth.json` (поиск 2026-11-08). Вход — через `accountInfo()` (ADR-0009),
   лимиты — через SDK (`src/main/vendors/claude/limits.ts:1-13`). Запрет «collect, store, or intermediate» не задет.
6. **Anthropic не видит, что это worfy.** worfy не задаёт `CLAUDE_AGENT_SDK_CLIENT_APP` («SDK consumers can identify
   their app/library», `sdk.d.ts:1652-1653` в пакете SDK). Подмены нет, но трафик выглядит как безымянный SDK. Codex
   worfy называет себя честно: `clientInfo.name` «worfy» (`src/main/vendors/codex/app-server.ts:114`).
7. **Вход в Codex — managed ChatGPT login через app-server** (`account/login/start {type: "chatgpt"}`,
   `src/main/vendors/codex/account.ts:197`; токены остаются в CODEX_HOME, `account.ts:6-8`). Это и есть «Codex
   app-server authentication» из цитаты OpenAI: локально и бесплатно — можно, коммерчески — нет.
8. **Autopilot** идёт без человека, несколькими Session-ами сразу; упёршись в лимит, ждёт и продолжает
   (`docs/features/autopilot.md:112`). Сюда относятся «automated or non-human means» и «ordinary, individual usage».
9. **Link** открывает Project-ы другой Machine; их Session-ы идут там под её входом (`docs/features/link.md:3-5`, `:20`).
   Между двумя людьми это «make your Account available to anyone else»; документация worfy об этом молчит.
10. **Лицензии нет:** ни файла LICENSE, ни поля `license` в `package.json`. Формально это не open source.

## 4. Лимиты: «ordinary, individual usage» против долгих параллельных run-ов

- Страница legal, «Acceptable use»: «Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual
  usage of Claude Code and the Agent SDK.» Слово «ordinary» не определено, порогов нет; это оговорка, не запрет.
- Для самого Claude Code параллельная и автоматическая работа на подписке — обычная функция: «Running several sessions
  or subagents at once multiplies token usage» (https://code.claude.com/docs/en/agents); «For CI pipelines, scripts, or
  other environments where interactive browser login isn't available, generate a one-year OAuth token with `claude
  setup-token`» (https://code.claude.com/docs/en/authentication). Сторонний autopilot не назван нигде.
- 2025-07-28, перед недельными лимитами: «Some of the biggest Claude Code fans are running it continuously in the
  background, 24/7. These uses are remarkable and we want to enable them. But a few outlying cases are very costly to
  support.» (https://x.com/AnthropicAI/status/1949898511287226425). Ответом стали лимиты, а не запрет.
- 2026-05-13 Anthropic объявила: с 15 июня Agent SDK, `claude -p` и сторонние приложения тратят не лимиты плана, а
  месячный кредит (20, 100 и 200 USD для Pro, Max 5x и Max 20x); 15 июня это отложено. Блог Zed, вторичный источник
  (https://zed.dev/blog/anthropic-subscription-changes): «Anthropic says they are revising the plan».
- Autopilot не обходит лимиты: ждёт сброса окна и держит дневной бюджет (Eco mode). Но он может держать план занятым
  круглые сутки. Это не нарушение текста, а повод для Anthropic ужесточить лимиты или пометить аккаунт.
- «Individual» значит один человек: Link между двумя людьми и общий аккаунт на команду сюда не подходят.
- OpenAI для «programmatic Codex CLI workflows» советует API key; это рекомендация, а Codex SDK сам предлагает
  «automate coding tasks, including jobs in CI» (https://developers.openai.com/codex/sdk).

## 5. Похожие приложения и что Anthropic уже отключала

Собрано агентом; цитаты Conductor, Nimbalyst, Zed и посты в X я перечитал (X — через зеркало api.fxtwitter.com).
- **Conductor** (Mac, бесплатный, закрытый код): «Conductor uses native Claude Code, but we do so through the Claude
  Agent SDK, so that policy applied to us» (https://www.conductor.build/blog/claude-subscription-update). Берёт вход,
  что уже есть: API key или Pro/Max (https://www.conductor.build/docs/faq). Для Codex с 2026-09-29 — партнёр Sign in
  with ChatGPT.
- **Nimbalyst** (преемник Crystal, MIT, Agent SDK): «Use your Claude subscription login or an Anthropic API key that you
  explicitly add in Nimbalyst. Nimbalyst does not import API keys from environment variables.»
  (https://nimbalyst.com/docs/setup-nimbalyst/ai-provider-setup-and-notifications). Codex — через `account/login/start`.
- **Zed** (адаптер ACP на Agent SDK): `/login` предлагает подписку или Console; с 2026-09-04 флаг `--hide-claude-auth`
  прячет вход по подписке. Свой агент Zed с 2026-05-15 работает на плане ChatGPT вместе с OpenAI.
- **Vibe Kanban** (Apache-2.0): вход делает сам CLI; опция `disable_api_key` убирает `ANTHROPIC_API_KEY`, как worfy.
  **Claude Squad** и **opcode** (AGPL-3.0) запускают `claude` из PATH и о правилах молчат.
- Своей страницы входа в Claude нет ни у кого: только вход самого CLI или API key. О правилах говорят лишь приложения
  на Agent SDK и ссылаются на Anthropic. Публичного «previously approved» нет ни у кого.
- 2026-01-09, Thariq Shihipar (Anthropic): «Yesterday we tightened our safeguards against spoofing the Claude Code
  harness» (https://x.com/trq212/status/2009689809875591565). По данным агента, это клиенты вроде OpenCode, которые
  сами слали токен подписки под видом Claude Code.
- 2026-02-18 на странице legal появилась фраза, что OAuth подписки «in any other product, tool, or service — including
  the Agent SDK — is not permitted» (The Register, 2026-02-20; по данным агента, в апреле её убрали). В тот же день
  Thariq: «Nothing is changing about how you can use the Agent SDK and MAX subscriptions!» и «We want to encourage
  local development and experimentation with the Agent SDK and claude -p. If you're building a business on top of the
  Agent SDK, you should use an API key instead.» (https://x.com/trq212/status/2024212378402095389,
  https://x.com/trq212/status/2024212380142752025)
- 2026-04-03, Boris Cherny (Anthropic): «Starting tomorrow at 12pm PT, Claude subscriptions will no longer cover usage
  on third-party tools like OpenClaw. You can still use these tools with your Claude login via extra usage bundles (now
  available at a discount), or with a Claude API key.» (https://x.com/bcherny/status/2040206440556826908).
- Случая против приложения на немодифицированном Claude Code или Agent SDK со входом самого пользователя агент не нашёл.
  Блокировок OpenAI за вход ChatGPT тоже нет; глава Codex 2026-01-09: «You can already build on top of … directly,
  which includes ChatGPT login and same usage as you get in codex» (https://x.com/thsottiaux/status/2009714843587342393).

## 6. Самые дешёвые способы получить уверенность (по возрастанию цены)

1. **Письмо в Anthropic** через «contact sales» со страницы legal: «For questions about permitted authentication
   methods for your use case, please contact sales» (https://www.anthropic.com/contact-sales). 0 USD, срок ответа
   неизвестен. Вопросы «да или нет»: покрывает ли исключение для «unmodified Claude Code binary» запуск через Agent SDK;
   нужно ли «previously approved»; ограничивает ли вход удаление `ANTHROPIC_API_KEY`; меняется ли ответ при оплате.
2. **Мелкие правки, один Ticket.** `CLAUDE_AGENT_SDK_CLIENT_APP=worfy/<version>` — честная подпись трафика; цена:
   Anthropic проще отключить именно worfy. В README и onboarding: Claude Code запускается так, как его выпустила
   Anthropic; вход — своим аккаунтом; Link — только между своими машинами; worfy не связан с Anthropic.
3. **Принять Commercial Terms как издатель:** аккаунт Claude Console бесплатен, Terms действуют с первого согласия или
   первого доступа. Есть ли такой аккаунт у владельца — неизвестно.
4. **Не мешать своему API key:** оставлять `ANTHROPIC_API_KEY`, если пользователь сам включил это в настройках. Один-два
   Ticket-а; меняет ADR-0007, то есть нужно решение владельца.
5. **Необязательный режим API key для Claude.** Для Max и Ultra он почти бесплатен: «Max, Ultra, and Team plans include
   monthly credits for the Claude Platform» — 100 и 200 USD в месяц, они покрывают «The Claude Agent SDK» с API key
   (https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-ultra-and-team-plans). Серая зона для
   такого режима исчезает. Цена — несколько Ticket-ов и отмена решения «Никогда: всё, что требует API-ключа»
   (`.scratch/worfy-multi-vendor/spec.md:54`, `:403`) и ADR-0009 (worfy не держит ключей).
6. **Платный Codex:** форма партнёра Sign in with ChatGPT (https://openai.com/form/sign-in-with-chatgpt-interest/)
   бесплатна. Интеграция дорогая: «Your app should read its own token file and supply the access token to the child
   process» (https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server), а worfy токенов не держит.
7. **Юрист** — дороже всего; нужен только перед платной версией.

## 7. Что не удалось проверить

- Покрывает ли исключение для «unmodified Claude Code binary» продукт, который запускает binary через Agent SDK:
  тексты расходятся, ответить может только Anthropic. Есть ли у кого-то статус «previously approved» — не видно.
- Как OpenClaw подключался к Claude (свой клиент или настоящий Claude Code), не проверено. От этого зависит, касается
  ли апрельское отключение приложений вроде worfy.
- По данным агента, не перечитано (web.archive.org ограничил мои запросы): раздел о входе на странице legal появился
  2026-02-18, фразу «including the Agent SDK» убрали в апреле, раздел «Can customers offer…» добавили в конце августа,
  «third-party apps» убрали из support-статьи 26–27 октября. Причины правок неизвестны.
- Относится ли «you can continue using it» у OpenAI к приложениям, сделанным после запуска Sign in with ChatGPT в конце
  сентября 2026: код Codex в worfy появился 2026-11-02. Принимал ли владелец Commercial Terms — неизвестно.
