# 12 — Рецепт Slack: что касается пользователя с прошлой проверки

Type: task
Status: done 2026-11-25T22:07Z
PR: #2239
Branch: worfy-assistant/12
Blocked by: 04, 11
Source: [spec.md](../spec.md), «Ticket-ы», строка 12; «Решения владельца», 5 и 19; «Решения по реализации» → «Проверка
источников через connectors claude.ai», «Рецепт источника»; «Риски» («Connectors claude.ai»); «Решения по test-ам»;
история 10; «Волны», Wave 3

Кто: агент.

## Что строить

Рецепт источника Slack для проверки через connector claude.ai (Ticket 11):

- что искать — «что касается пользователя» с прошлой проверки;
- какие tools connector-а Slack разрешены — только read tools;
- проверка зарегистрирована в планировщике (Ticket 04) со своим интервалом; Slack — около 10 минут;
- пользователь видит только то, что касается его.

## Где в коде

- Проверка источника — Ticket 11; планировщик и work hours — Ticket 04 (пути — в их «Итог»).

## Решения

- Регулярная проверка Slack, у типа свой интервал — около 10 минут; настраиваются work hours и тип проверки
  (решение 5).
- Slack — через connector claude.ai, вариант В (решение 19).
- Рецепт говорит вызову, что искать («что касается пользователя» с прошлой проверки) и какие tools разрешены (spec,
  «Рецепт источника»).

## Test-ы

Записанные ответы вызова — fixture-ы; test-ы не вызывают модель и не ходят в сеть; пункты подаются в стык А (spec,
«Решения по test-ам»).

## Готово, когда

- [ ] Рецепт Slack задаёт поиск «что касается пользователя» с прошлой проверки и список разрешённых read tools.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-slack-recipe.test.ts` exit 0 · mac - · 389fc7d42
  - evidence: review pass · PR #2239 · - - · 2c131984da0dca51c19dcbeac0d4c46ec4afd246
- [ ] Unit test на записанном ответе: из ответа вызова получаются пункты; пункт, который не касается пользователя, не
      показывается.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-slack-recipe.test.ts` exit 0 · mac - · 389fc7d42
  - evidence: review pass · PR #2239 · - - · 2c131984da0dca51c19dcbeac0d4c46ec4afd246
- [ ] Unit test: следующая проверка ищет с времени прошлой.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-slack-recipe.test.ts` exit 0 · mac - · 389fc7d42
  - evidence: review pass · PR #2239 · - - · 2c131984da0dca51c19dcbeac0d4c46ec4afd246
- [ ] Проверка Slack зарегистрирована в планировщике Ticket-а 04 с интервалом около 10 минут по умолчанию.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-slack-recipe.test.ts` exit 0 · mac - · 389fc7d42
  - evidence: commit pass · worfy-assistant/12: the Slack recipe — what concerns the user since the last check, read tools only · - - · 389fc7d42
  - evidence: review pass · PR #2239 · - - · 2c131984da0dca51c19dcbeac0d4c46ec4afd246
- [ ] Записанные ответы лежат как fixture-ы; test-ы не вызывают модель и не ходят в сеть.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-slack-recipe.test.ts` exit 0 · mac - · 389fc7d42
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/45699584423/job/139540482140 · ci - · 2c131984da0dca51c19dcbeac0d4c46ec4afd246
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: test-run pass · `pnpm lint` exit 0, `pnpm typecheck` exit 0 · mac - · 389fc7d42
  - evidence: review pass · PR #2239 · - - · 2c131984da0dca51c19dcbeac0d4c46ec4afd246

## Итог

- Красный до правки: `node scripts/vitest-electron.mjs test/unit/assistant-slack-recipe.test.ts` — exit 1, нет модуля
  `src/main/assistant/sources/slack.ts`.
- Рецепт — `src/main/assistant/sources/slack.ts`: `slackRecipe` (вид `slack`, connector `claude.ai Slack`,
  `SLACK_READ_TOOLS`, задача `slackTask`) и `registerSlackCheck`. Задача вызову: сообщения Slack, которые касаются
  пользователя, со `since` (начало прошлой успешной проверки, его даёт планировщик Ticket-а 04) до старта этой; текст
  Slack — данные, а не инструкции.
- Пункт, который не касается пользователя, не идёт в ядро внимания: у рецепта Ticket-а 11 новое необязательное поле
  `keeps(item)` (`src/main/assistant/sources/connector-check.ts`, две строки); рецепт без него, как Jira Ticket-а 13,
  ведёт себя по-прежнему. Время, которое покрыл ответ на пределе, считается по всем прошедшим проверку пунктам, и
  отброшенным тоже.
- Регистрация — `src/main/index.ts`: `registerSlackCheck(checkScheduler(), appSourceCheck)` рядом со стартом
  планировщика. Интервал по умолчанию — 10 минут (`ASSISTANT_CHECK_DEFAULTS` Ticket-а 04), проверка выключена, пока
  пользователь не включит Slack.
- Записанный ответ — `test/fixtures/assistant-sources/slack-answer.jsonl`; test — `test/unit/assistant-slack-recipe.test.ts`
  (fake Claude Code, без модели и сети). Mutant «без `keeps`» — два test-а красные.
- Новых файлов состояния worfy нет: строка в ADR-0005 не нужна.
- Решено без владельца — подтверждено владельцем 2026-11-26:
  - «касается пользователя» — личное или групповое личное сообщение, упоминание пользователя или его группы, ответ в
    thread-е, который он начал или где писал, сообщение, которое называет его Project; свои сообщения пользователя не
    в счёт;
  - «срочно» — просьба на сегодня, срок в пределах дня, авария, красный deploy или blocker;
  - read tools: `slack_read_user_profile`, `slack_search_public_and_private`, `slack_search_public`,
    `slack_read_thread`, `slack_read_channel` — имена MCP-сервера Slack на 2026-11, без живой проверки; имя, которого у
    connector-а нет или которое он помечает как пишущее, вызов отбрасывает сам;
  - connector узнаётся по точному имени `claude.ai Slack`;
  - фильтр Slack `after:` — на два дня раньше UTC-дня `since`, чтобы не терять сообщения ни в одном поясе; точнее
    время отсекает сам вызов;
  - пункты, которые не касаются пользователя, отбрасываются в main даже если вызов их вернул, и в журнал не пишутся.
- Не проверено вживую (первый настоящий вызов — приёмка): имена tools настоящего connector-а Slack, как Haiku 5.5
  понимает задачу, сколько token-ов занимают эти tools.
