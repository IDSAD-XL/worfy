# API-кредиты подписки Ultra: можно ли на них гонять eval-ы — research

Прочитано 2026-11-24. Источник — справка Anthropic «Monthly API credits for Max, Ultra and Team plans»:
https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-ultra-and-team-plans. Цены моделей — из
справочника Claude API на 2026-11-03.

Повод — ответ владельца 2026-11-24: «у меня ультра подписка клода, которая предполагает 200$ на апи в месяц, помимо
самой подписки, можно их здесь и потратить».

## Что говорит справка

- Ultra даёт 200 USD API-кредитов в месяц.
- Кредиты приходят в организацию Claude Console, которую подписчик привязывает к плану: claude.ai, Settings → Billing.
  Привязать можно одну организацию. Сменить привязку можно только через поддержку.
- Неистраченное не переносится: «Unused credits expire at the end of each billing cycle».
- Когда кредиты кончились: если у организации есть купленные кредиты или auto-reload, расход идёт из них. Если нет —
  «API requests stop until your next monthly credits arrive». С плана деньги не списываются никогда.
- Claude Code: «API credits cover `claude -p` and the Claude Agent SDK when you run them yourself with an API key».
  Если же запуск идёт под входом подписки, он тратит лимиты подписки, а не кредиты. Интерактивный Claude Code,
  расширения IDE и desktop-приложение кредитами не оплачиваются.
- Ограничений по моделям справка не называет: «The credits work with any available Claude model on the Claude
  Platform». Отдельных rate limits тоже не называет. Тратами можно управлять лимитами расходов на workspace в Console.

## Что это значит для eval-ов Harness

- `claude plugin eval` запускает каждый run как `claude -p`. С API key привязанной организации такой run, по
  справке, оплачивается кредитами, а не лимитами подписки. Скрипты eval-ов ключ не трогают:
  `scripts/eval-run-env.mjs` не упоминает `ANTHROPIC_API_KEY`. Первым делом это надо проверить одним маленьким run-ом
  по расходу в Console.
- Без auto-reload и купленного баланса 200 USD в месяц — жёсткий потолок: запросы просто остановятся.
- Сейчас eval-ы тратят лимиты подписки, а у аккаунта с 2026-11-13 снова есть окно на 5 часов. На кредитах eval-ы
  перестанут отнимать лимит у работы.
- `costUsd` в отчётах eval-ов — оценка по прайс-листу API. С API key это и будет фактический расход кредитов.
- Цены по прайс-листу за 1M token-ов, вход / выход: `claude-sonnet-5` (агент eval-ов) — 2 / 10 USD;
  `claude-haiku-4-5` (judge) — 1 / 5 USD; `claude-opus-5-5` (judge Tier 3 SkillEvaluator по умолчанию) — 4 / 20 USD.

## Что не проверено

- Что `claude plugin eval` с `ANTHROPIC_API_KEY` действительно списывает кредиты, а не лимит подписки. Справка
  называет только `claude -p` и Agent SDK.
- Привязана ли уже организация Console к подписке владельца и есть ли у неё auto-reload.
