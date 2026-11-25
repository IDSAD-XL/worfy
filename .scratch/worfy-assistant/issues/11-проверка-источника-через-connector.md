# 11 — Проверка источника через connector claude.ai: одноразовый вызов Haiku 5.5 только с read tools одного connector-а

Type: task
Status: open
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
- [ ] Unit test: список подключённых connectors main берёт из списка MCP-серверов Claude Code без вызова модели.
- [ ] Unit test опций: вызов — Haiku 5.5, один connector, только его read tools; нет tools Claude Code, `worfy-app` и
      настроек Project-а.
- [ ] Unit test на записанных ответах: правильный ответ даёт пункты со всеми полями из «Что строить», 5; ответ неверной
      формы пунктом не становится и пишется в журнал.
- [ ] Test-ы не вызывают модель и не ходят в сеть.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
